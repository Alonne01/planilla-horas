// Cálculo salarial — portado y verificado desde EquipTrack/.../CalculoSalarialUtil.kt
//
//  • CCT 637/11 (Jerárquicos): hora extra = básico ÷ 147,78.
//  • CCT 644/12 (Privados):    hora extra = base conformada ÷ 180.
//    Fórmulas verificadas AL CENTAVO contra 13 recibos reales 03/2025–04/2026.
//    Detalle en SALARY_CALC_SPEC_644.md (637/11 en SALARY_CALC_SPEC.md).
//
// Las horas (normales / 50% / 100%) se calculan con calcularHorasDia (misma lógica que
// el resto de la app). El diferencial nocturno (sólo 644) se calcula acá (LCT Art.200).

import type { AppSettings, RegistroHoras } from '../db/database'
import { calcularHorasDia, esDiaNoTrabajado, horasViajeSeparadas, type LineaTrabajo } from './calculo-horas'

export type Convenio = 'CCT_637_11' | 'CCT_644_12'
export type TipoTurno = 'NINGUNO' | 'TURNO_A' | 'TURNO_B' | 'TURNO_S'

/** Tope previsional ANSES (abril 2026). Escala ~mensual: actualizar cuando cambie. */
const TOPE_ANSES = 4_162_912.55
/** Divisor del desarraigo jerárquico (147,78 ÷ 5). */
const DIAS_BASE_637 = 147.78 / 5.0

// CCT 644/12 — escenario fijo de WENLEN (servicios especiales en Vaca Muerta).
// Verificado contra 13 recibos (mar-2025 → abr-2026): el operario SIEMPRE cobra
// turno 33%, zona Vaca Muerta y desarraigo 20%. Por eso el estimado privado se
// calcula sólo con el básico (igual que jerárquicos). Si la situación cambia, tocar acá.
const PRIV_TURNO: TipoTurno = 'TURNO_S' // serv. especiales = 33% (en el recibo figura "turno A", mismo 0,33)
const PRIV_ZONA_VM = true               // Añelo / Rincón de los Sauces = Vaca Muerta (+85% desde 11/2025)
const PRIV_TASA_DESARRAIGO = 0.20       // "Desarraigo 20%" (cód. 191) en los 13 recibos

export const CONVENIOS: { key: Convenio; label: string; divisor: number }[] = [
  { key: 'CCT_637_11', label: 'CCT 637/11 · Jerárquicos', divisor: 147.78 },
  { key: 'CCT_644_12', label: 'CCT 644/12 · Privados', divisor: 180.0 },
]

export const TURNOS: { key: TipoTurno; label: string; factor: number }[] = [
  { key: 'NINGUNO', label: 'Sin turno', factor: 0.0 },
  { key: 'TURNO_A', label: 'Turno A (rotativo 24 h)', factor: 0.33 },
  { key: 'TURNO_B', label: 'Turno B (semana no calendaria)', factor: 0.22 },
  { key: 'TURNO_S', label: 'Turno S (operaciones especiales)', factor: 0.33 },
]

function turnoFactor(t: TipoTurno): number {
  return TURNOS.find(x => x.key === t)?.factor ?? 0
}

export function convenioLabel(c: Convenio): string {
  return CONVENIOS.find(x => x.key === c)?.label ?? c
}

// ─── Gate de acceso (período de prueba) ──────────────────────────────────────
// La proyección salarial queda oculta para todos salvo el usuario de prueba.
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
// Whitelist de la versión de prueba del cálculo salarial: SÓLO estos nombres ven la
// pestaña "Sueldo" y la sección "Salario y convenio". Agregá testers a la lista (no
// importan acentos, mayúsculas/minúsculas ni espacios de más: se normaliza solo).
// Para LIBERARLO A TODOS: poné `SALARY_WHITELIST_ABIERTA = true` (o hacé que
// isSalaryUser devuelva true).
const SALARY_WHITELIST_ABIERTA = false
const SALARY_WHITELIST: string[] = [
  'calc',              // palabra clave: con este nombre + el gesto secreto del caracol (15 toques) se desbloquea
  // 'Nicolas Vazquez',
  // 'Aviles Lucas',
  // 'Juan Pérez',
  // 'Otro Tester',
].map(normalizar)

export function isSalaryUser(nombre: string | undefined | null): boolean {
  if (SALARY_WHITELIST_ABIERTA) return true
  if (!nombre) return false
  return SALARY_WHITELIST.includes(normalizar(nombre))
}

// ─── Gate de la pantalla de admin (padrón) ───────────────────────────────────
// Identidad sentinela para desbloquear SÓLO la pantalla de admin (no el salario): nombre
// "Nicolas Vazquez" + código "000000". Combinado con el gesto de 3 toques al caracol.
const ADMIN_NOMBRE = normalizar('Nicolas Vazquez')
const ADMIN_CODIGO = '000000'
export function esAdminNube(nombre: string | undefined | null, codigo: string | undefined | null): boolean {
  return normalizar(nombre ?? '') === ADMIN_NOMBRE && (codigo ?? '').trim() === ADMIN_CODIGO
}

// SEGUNDO factor del admin: además de nombre "Nicolas Vazquez" + 000000 + 3 toques al caracol, hay que
// escribir un código en el campo extra "Código" (aparece sólo al cumplir esAdminNube). El código NO
// está en el bundle en texto plano: sólo guardamos su HASH PBKDF2-SHA256 (150k iteraciones, salt fijo);
// al desbloquear se hashea lo tipeado y se compara. Así no es grep-eable ni reversible al instante.
// OJO: sigue siendo obfuscación del CLIENTE, NO auth real — un técnico puede saltear el candado (estado
// del cliente) o ir directo a Firestore. Para exclusividad real: Firebase Auth + reglas por UID.
// Es estado de módulo (no se persiste): lo setea Settings al tipear y lo lee App al validar el gesto.
const ADMIN_CODIGO_2_HASH = 'cgAL0G6dsPJGQS7BUi-wYcrh9DXIYkJKKhLLUe2PRBE'
let _adminCodigo2 = ''
export function setAdminCodigo2(c: string | undefined | null): void { _adminCodigo2 = (c ?? '').trim() }

async function hashCodigoAdmin(codigo: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(codigo), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('planilla-admin-2:v1'), iterations: 150_000, hash: 'SHA-256' },
    keyMaterial, 256,
  )
  const bytes = new Uint8Array(bits)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function esAdminCodigo2Ok(): Promise<boolean> {
  if (!/^\d{4,8}$/.test(_adminCodigo2)) return false
  try { return (await hashCodigoAdmin(_adminCodigo2)) === ADMIN_CODIGO_2_HASH } catch { return false }
}

// ─── Gate de donación (MercadoPago) ──────────────────────────────────────────
// Mismo mecanismo de nombre que el gate salarial: el botón de donar aparece SÓLO
// para estos nombres (no importan acentos/mayúsculas/espacios: se normaliza).
// Para ABRIRLO A TODOS (que cualquiera que use la app pueda donar) poné
// `DONATION_WHITELIST_ABIERTA = true`.
export const MERCADOPAGO_DONACION_URL = 'https://link.mercadopago.com.ar/nvzqz'
const DONATION_WHITELIST_ABIERTA = false
const DONATION_WHITELIST: string[] = [
  'Nicolas Vazquez',
  // '666',  // descomentá para desbloquearlo con el nombre de prueba
].map(normalizar)

export function isDonationUser(nombre: string | undefined | null): boolean {
  if (DONATION_WHITELIST_ABIERTA) return true
  if (!nombre) return false
  return DONATION_WHITELIST.includes(normalizar(nombre))
}

// ─── Desbloqueo del DONADOR por usuario (vista previa) ────────────────────────
// El donador global arranca APAGADO (config.beggarActivo=false) y el admin lo prende cuando quiere.
// Esta whitelist lo DESBLOQUEA igual para identidades puntuales (p.ej. el admin), para verlo/probarlo
// aunque esté apagado para todos. Agregar/quitar nombres acá (se compara normalizado, sin código).
const BEGGAR_UNLOCK_WHITELIST: string[] = [
  'Nicolas Vazquez',
  // 'Otro Nombre',
].map(normalizar)

export function esBeggarUnlock(nombre: string | undefined | null): boolean {
  if (!nombre) return false
  return BEGGAR_UNLOCK_WHITELIST.includes(normalizar(nombre))
}

// ─── Config ──────────────────────────────────────────────────────────────────
export interface SalaryConfig {
  convenio: Convenio
  sueldoBasico: number
  antiguedadAnios: number
  tipoTurno: TipoTurno
  zonaVacaMuerta: boolean
  tasaDesarraigo644: number // 0 / 0,10 / 0,20
  lineaTrabajo: LineaTrabajo // SBDP suma 12 h al 50% por día de Campo
}

/** Años completos de antigüedad desde la fecha de ingreso (0 si no está cargada). */
export function calcAntiguedadAnios(fechaIngresoMs: number): number {
  if (!fechaIngresoMs) return 0
  const ing = new Date(fechaIngresoMs)
  const hoy = new Date()
  let anios = hoy.getFullYear() - ing.getFullYear()
  const cumpleAun =
    hoy.getMonth() < ing.getMonth() ||
    (hoy.getMonth() === ing.getMonth() && hoy.getDate() < ing.getDate())
  if (cumpleAun) anios--
  return Math.max(0, anios)
}

export function configFromSettings(s: AppSettings): SalaryConfig {
  return {
    convenio: s.convenio,
    sueldoBasico: s.sueldoBasico,
    antiguedadAnios: calcAntiguedadAnios(s.fechaIngresoMs),
    tipoTurno: s.tipoTurno,
    zonaVacaMuerta: s.zonaVacaMuerta,
    tasaDesarraigo644: s.tasaDesarraigo644,
    lineaTrabajo: s.lineaTrabajo,
  }
}

// ─── Horas nocturnas (LCT Art.200: 21:00–06:00) ───────────────────────────────
function overlapNocturno(entradaMs: number, salidaMs: number): number {
  const d1 = new Date(entradaMs)
  const start = d1.getHours() + d1.getMinutes() / 60
  const d2 = new Date(salidaMs)
  let end = d2.getHours() + d2.getMinutes() / 60
  if (end < start) end += 24 // turno que cruza medianoche
  // Ventana nocturna [21:00, 06:00] → [21, 30] en horas continuas
  let overlap = Math.max(0, Math.min(end, 30) - Math.max(start, 21))
  // Turnos que arrancan antes de las 06:00 del mismo día (ej. 02:00–10:00)
  overlap += Math.max(0, Math.min(end, 6) - Math.max(start, 0))
  return overlap
}

function calcularHorasNocturnas(reg: RegistroHoras): number {
  let total = 0
  if (reg.entradaInicioMs != null && reg.salidaInicioMs != null) {
    total += overlapNocturno(reg.entradaInicioMs, reg.salidaInicioMs)
  }
  if (reg.entradaFinMs != null && reg.salidaFinMs != null) {
    total += overlapNocturno(reg.entradaFinMs, reg.salidaFinMs)
  }
  return total
}

// ─── Agregados del período ─────────────────────────────────────────────────────
interface Agregados {
  total50: number
  total100: number
  totalViaje: number
  totalNocturnas: number
  diasTrabajados: number
  diasCampo: number
  diasBase: number
  pernoctes: number
  pernoctesTrailer: number
  faltasInjustificadas: number
}

function agregar(registros: RegistroHoras[], linea: LineaTrabajo): Agregados {
  let total50 = 0, total100 = 0, totalViaje = 0, totalNocturnas = 0
  let diasTrabajados = 0, diasCampo = 0, diasBase = 0, pernoctes = 0, pernoctesTrailer = 0
  let faltasInjustificadas = 0

  for (const reg of registros) {
    if (reg.esFaltaInjustificada) { faltasInjustificadas++; continue } // inasistencia: descuenta aparte
    if (esDiaNoTrabajado(reg) || reg.esAusenciaJustificada) continue
    const h = calcularHorasDia(reg, linea)
    if (h.horasTrabajadas > 0) {
      diasTrabajados++
      total50 += h.horasAl50
      total100 += h.horasAl100
      totalNocturnas += calcularHorasNocturnas(reg)
      if (reg.lugarTrabajo === 'Campo') diasCampo++
      else if (reg.lugarTrabajo === 'Base') diasBase++
    }
    totalViaje += horasViajeSeparadas(reg)
    if (reg.pernocte === 'Hotel' || reg.pernocte === 'Trailer') pernoctes++
    if (reg.pernocte === 'Trailer') pernoctesTrailer++
  }
  return { total50, total100, totalViaje, totalNocturnas, diasTrabajados, diasCampo, diasBase, pernoctes, pernoctesTrailer, faltasInjustificadas }
}

/**
 * Descuento por inasistencia injustificada, común a ambos convenios:
 *  - básico proporcional: (B / 30) por cada día de falta;
 *  - presentismo: se pierde el presentismo del período si hay al menos una falta.
 * Es una aproximación (no hay recibo real con faltas para validarlo); el resto del
 * jornal (antigüedad, turno, zona, etc.) no se prorratea. Devuelve ítems NEGATIVOS.
 */
function itemsInasistencia(faltas: number, basico: number, presentismo: number, codBasico: string, codPres: string): LineItem[] {
  if (faltas <= 0) return []
  const items: LineItem[] = [
    { codigo: codBasico, concepto: `Inasistencia injust. (${faltas} ${faltas === 1 ? 'día' : 'días'})`, monto: -(basico / 30) * faltas },
  ]
  if (presentismo > 0) items.push({ codigo: codPres, concepto: 'Pérdida de presentismo (inasist.)', monto: -presentismo })
  return items
}

// ─── Tipos de salida ────────────────────────────────────────────────────────────
export interface LineItem { codigo: string; concepto: string; monto: number }

export interface SalaryEstimate {
  convenio: Convenio
  horaBase: number
  totalExtra50: number
  totalExtra100: number
  totalViaje: number
  totalNocturnas: number
  diasTrabajados: number
  diasCampo: number
  diasBase: number
  diasPernocte: number
  fijoItems: LineItem[]
  subtotalFijos: number
  variableItems: LineItem[]
  subtotalVariables: number
  noRemItems: LineItem[]
  subtotalNoRemunerativo: number
  baseImponibleRaw: number
  baseImponibleCapped: number
  retencionItems: LineItem[]
  retenciones: number
  bruto: number
  netoEstimado: number
}

function fmtHs(h: number): string {
  return (Math.round(h * 10) / 10).toString()
}

// ══════════════════════════════════════════════════════════════════════════════
//  Entry point
// ══════════════════════════════════════════════════════════════════════════════
export function calcularSueldo(registros: RegistroHoras[], config: SalaryConfig): SalaryEstimate {
  const agg = agregar(registros, config.lineaTrabajo)
  return config.convenio === 'CCT_644_12' ? calcular644(config, agg) : calcular637(config, agg)
}

// ── CCT 637/11 — Jerárquicos (ratios verificados recibo 04/2026) ──
function calcular637(config: SalaryConfig, a: Agregados): SalaryEstimate {
  const B = config.sueldoBasico
  const hb = B / 147.78

  const antiguedad = (B / 342.46) * config.antiguedadAnios
  const presentismo = B * 0.057449
  const bonoPaz = B * 0.122516
  const adicTorre = B * 0.195777
  const acta1 = B * 0.392576
  const acta2 = B * 0.058886

  const fijoItems: LineItem[] = [
    { codigo: '3001', concepto: 'Sueldo Básico', monto: B },
    { codigo: '3010', concepto: `Antigüedad (${config.antiguedadAnios} años)`, monto: antiguedad },
    { codigo: '3050', concepto: 'Presentismo', monto: presentismo },
    { codigo: '3060', concepto: 'Bono Paz Social', monto: bonoPaz },
    { codigo: '3065', concepto: 'Adicional Torre/Campo', monto: adicTorre },
    { codigo: '3373', concepto: 'Ant. Acta 9/11/22', monto: acta1 },
    { codigo: '3374', concepto: 'Ant. Acta 22/10/25', monto: acta2 },
  ]
  const subtotalFijos = fijoItems.reduce((s, i) => s + i.monto, 0)

  const varViaje = a.totalViaje * (hb * 0.43157)
  const varExtra50 = a.total50 * (hb * 1.5)
  const varExtra100 = a.total100 * (hb * 2.0)
  const desarraigo = (B * 0.20) / DIAS_BASE_637 * a.pernoctes

  const variableItems: LineItem[] = []
  if (a.totalViaje > 0) variableItems.push({ codigo: '3130', concepto: `Horas Viaje (${fmtHs(a.totalViaje)} hs)`, monto: varViaje })
  if (a.total50 > 0) variableItems.push({ codigo: '3150', concepto: `Extras 50% (${fmtHs(a.total50)} hs)`, monto: varExtra50 })
  if (a.total100 > 0) variableItems.push({ codigo: '3155', concepto: `Extras 100% (${fmtHs(a.total100)} hs)`, monto: varExtra100 })
  if (desarraigo > 0) variableItems.push({ codigo: '3172', concepto: `Desarraigo 20% (${a.pernoctes} días)`, monto: desarraigo })
  variableItems.push(...itemsInasistencia(a.faltasInjustificadas, B, presentismo, '3500', '3501'))
  const subtotalVariables = variableItems.reduce((s, i) => s + i.monto, 0)

  const biRaw = subtotalFijos + subtotalVariables
  const biCapped = Math.min(biRaw, TOPE_ANSES)
  const biSindical = subtotalFijos + varViaje + varExtra50 + varExtra100

  const retencionItems: LineItem[] = [
    { codigo: '20000', concepto: 'Jubilación 11%', monto: biCapped * 0.11 },
    { codigo: '20001', concepto: 'Ley 19.032 (PAMI) 3%', monto: biCapped * 0.03 },
    { codigo: '20002', concepto: 'Obra Social 3%', monto: biCapped * 0.03 },
    { codigo: '20130', concepto: 'Cuota Sindical 2,73%', monto: biSindical * 0.0273 },
    { codigo: '20131', concepto: 'Mutual PJ 4,09%', monto: biSindical * 0.0409 },
  ]
  const retenciones = retencionItems.reduce((s, i) => s + i.monto, 0)

  const noRemItems: LineItem[] = [
    { codigo: '40310', concepto: `Viandas art.34 (${a.diasTrabajados} días)`, monto: a.diasTrabajados * 35849 },
    { codigo: '40316', concepto: `Desayuno y Merienda (${a.diasTrabajados} días)`, monto: a.diasTrabajados * 5262 },
  ]
  if (a.diasCampo > 0) noRemItems.push({ codigo: '40312', concepto: `Viandas Adicionales (${a.diasCampo} días)`, monto: a.diasCampo * 18699 })
  noRemItems.push(
    { codigo: '40497', concepto: 'SNR 3% s/remunerativo', monto: biRaw * 0.03 },
    { codigo: '40498', concepto: 'SNR 3% s/no remunerativo', monto: 3 * 14787 },
    { codigo: '42220', concepto: 'Asig. Vaca Muerta', monto: 448400 },
    { codigo: '42210', concepto: 'Asig. Vianda Fija', monto: 546197 },
  )
  const subtotalNoRemunerativo = noRemItems.reduce((s, i) => s + i.monto, 0)

  const bruto = subtotalFijos + subtotalVariables + subtotalNoRemunerativo
  return {
    convenio: 'CCT_637_11', horaBase: hb,
    totalExtra50: a.total50, totalExtra100: a.total100, totalViaje: a.totalViaje, totalNocturnas: 0,
    diasTrabajados: a.diasTrabajados, diasCampo: a.diasCampo, diasBase: a.diasBase, diasPernocte: a.pernoctes,
    fijoItems, subtotalFijos, variableItems, subtotalVariables,
    noRemItems, subtotalNoRemunerativo,
    baseImponibleRaw: biRaw, baseImponibleCapped: biCapped,
    retencionItems, retenciones,
    bruto, netoEstimado: bruto - retenciones,
  }
}

// ── CCT 644/12 — Privados (verificado al centavo contra 13 recibos) ──
function calcular644(config: SalaryConfig, a: Agregados): SalaryEstimate {
  const B = config.sueldoBasico

  // Paso 1: conformado. Valor unitario = B × 0,99108% (= antigüedad/año = hora de viaje).
  const valorUnidad = B * 0.0099108
  const antiguedad = valorUnidad * config.antiguedadAnios
  const turnoAdic = B * turnoFactor(PRIV_TURNO)
  const zonaVM = PRIV_ZONA_VM ? (B + turnoAdic) * 0.85 : 0
  const conformado = B + turnoAdic + zonaVM

  // Pasos 2–3: adicionales fijos del convenio (% del básico).
  const adicCampo = B * 0.66446
  const bonoPaz = B * 0.41539

  // Paso 4: valor hora extra = (conformado + campo + bono + antigüedad) ÷ 180.
  const hb = (conformado + adicCampo + bonoPaz + antiguedad) / 180.0

  // Paso 5: variables.
  const varExtra50 = a.total50 * hb * 1.5
  const varExtra100 = a.total100 * hb * 2.0
  const varViaje = a.totalViaje * valorUnidad
  const difNocturna = (hb / 7.5) * a.totalNocturnas

  // Paso 6: desarraigo — sólo se paga por días con pernocte en trailer (base/30 × días × tasa).
  const desarraigoBase = conformado + adicCampo + bonoPaz + varExtra50 + varExtra100 + difNocturna
  const desarraigo = a.pernoctesTrailer > 0
    ? (desarraigoBase / 30) * a.pernoctesTrailer * PRIV_TASA_DESARRAIGO
    : 0

  // Paso 7: presentismo = 6% de todo lo demás remunerativo.
  const presentismo = 0.06 * (conformado + antiguedad + adicCampo + bonoPaz + varExtra50 + varExtra100 + varViaje + difNocturna + desarraigo)

  const fijoItems: LineItem[] = [{ codigo: '2', concepto: 'Sueldo Básico', monto: B }]
  if (antiguedad > 0) fijoItems.push({ codigo: '30', concepto: `Antigüedad (${config.antiguedadAnios} años)`, monto: antiguedad })
  if (turnoAdic > 0) fijoItems.push({ codigo: '18', concepto: `Diferencial ${TURNOS.find(t => t.key === PRIV_TURNO)?.label ?? ''}`, monto: turnoAdic })
  if (zonaVM > 0) fijoItems.push({ codigo: '24', concepto: 'Zona Vaca Muerta +85%', monto: zonaVM })
  fijoItems.push(
    { codigo: '102', concepto: 'Adicional Torre/Campo', monto: adicCampo },
    { codigo: '100', concepto: 'Bono Paz Social', monto: bonoPaz },
    { codigo: '300', concepto: 'Presentismo 6%', monto: presentismo },
  )
  const subtotalFijos = fijoItems.reduce((s, i) => s + i.monto, 0)

  const variableItems: LineItem[] = []
  if (a.totalViaje > 0) variableItems.push({ codigo: '150', concepto: `Horas Viaje (${fmtHs(a.totalViaje)} hs)`, monto: varViaje })
  if (a.total50 > 0) variableItems.push({ codigo: '170', concepto: `Extras 50% (${fmtHs(a.total50)} hs)`, monto: varExtra50 })
  if (a.total100 > 0) variableItems.push({ codigo: '171', concepto: `Extras 100% (${fmtHs(a.total100)} hs)`, monto: varExtra100 })
  if (difNocturna > 0) variableItems.push({ codigo: '172', concepto: `Dif. Nocturnas (${fmtHs(a.totalNocturnas)} hs)`, monto: difNocturna })
  if (desarraigo > 0) variableItems.push({ codigo: '191', concepto: `Desarraigo ${Math.round(PRIV_TASA_DESARRAIGO * 100)}% (${a.pernoctesTrailer} días)`, monto: desarraigo })
  variableItems.push(...itemsInasistencia(a.faltasInjustificadas, B, presentismo, '500', '501'))
  const subtotalVariables = variableItems.reduce((s, i) => s + i.monto, 0)

  const biRaw = subtotalFijos + subtotalVariables
  const biCapped = Math.min(biRaw, TOPE_ANSES)

  const retencionItems: LineItem[] = [
    { codigo: '20000', concepto: 'Jubilación 11%', monto: biCapped * 0.11 },
    { codigo: '20001', concepto: 'Ley 19.032 (PAMI) 3%', monto: biCapped * 0.03 },
    { codigo: '20002', concepto: 'Obra Social 3%', monto: biCapped * 0.03 },
    { codigo: '20100', concepto: 'Cuota Sindical 2%', monto: biRaw * 0.02 },
    { codigo: '20101', concepto: 'Cuota Solidaria 2%', monto: biRaw * 0.02 },
    { codigo: '20102', concepto: 'Mutual MEOPP 3,9%', monto: biRaw * 0.039 },
  ]
  const retenciones = retencionItems.reduce((s, i) => s + i.monto, 0)

  const noRemItems: LineItem[] = [
    { codigo: '40010', concepto: `Vianda art.34 (${a.diasTrabajados} días)`, monto: a.diasTrabajados * 35849 },
    { codigo: '40016', concepto: `Desayuno y Merienda (${a.diasTrabajados} × 2)`, monto: a.diasTrabajados * 2 * 5224 },
  ]
  if (a.diasCampo > 0) noRemItems.push({ codigo: '40012', concepto: `Vianda horas extras (${a.diasCampo} × 2)`, monto: a.diasCampo * 2 * 18674 })
  noRemItems.push({ codigo: '40497', concepto: 'SNR 3% s/remunerativo', monto: biRaw * 0.03 })
  noRemItems.push({ codigo: '42210', concepto: 'Asig. Vianda Fija', monto: 546197 })
  if (PRIV_ZONA_VM) noRemItems.push({ codigo: '42220', concepto: 'Asig. Vaca Muerta', monto: 380000 })
  const subtotalNoRemunerativo = noRemItems.reduce((s, i) => s + i.monto, 0)

  const bruto = subtotalFijos + subtotalVariables + subtotalNoRemunerativo
  return {
    convenio: 'CCT_644_12', horaBase: hb,
    totalExtra50: a.total50, totalExtra100: a.total100, totalViaje: a.totalViaje, totalNocturnas: a.totalNocturnas,
    diasTrabajados: a.diasTrabajados, diasCampo: a.diasCampo, diasBase: a.diasBase, diasPernocte: a.pernoctes,
    fijoItems, subtotalFijos, variableItems, subtotalVariables,
    noRemItems, subtotalNoRemunerativo,
    baseImponibleRaw: biRaw, baseImponibleCapped: biCapped,
    retencionItems, retenciones,
    bruto, netoEstimado: bruto - retenciones,
  }
}

/** Formatea pesos argentinos sin decimales. */
export function fmtPesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR')
}

// ─── Formato del input de sueldo básico (es-AR: miles "." / decimal ",") ───────

/** Número → string es-AR para precargar el input ("" si es 0). Ej: 606113.47 → "606.113,47". */
export function fmtBasicoDisplay(n: number): string {
  if (!n || !isFinite(n)) return ''
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

/** Reformatea en vivo lo que tipea el usuario: puntos de miles + una sola coma decimal (máx. 2). */
export function formatBasicoInput(raw: string): string {
  let s = raw.replace(/[^\d,]/g, '')                                  // sólo dígitos y comas
  const i = s.indexOf(',')
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '') // una sola coma
  const [ent, dec] = s.split(',')
  const entFmt = ent.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return s.includes(',') ? `${entFmt || '0'},${(dec ?? '').slice(0, 2)}` : entFmt
}

/** String es-AR del input → número. Ej: "606.113,47" → 606113.47. */
export function parseBasicoInput(s: string): number {
  if (!s) return 0
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
}
