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

/** Tope previsional ANSES por mes (movilidad mensual). Verificado: jubilación del recibo ÷ 0,11.
 *  Meses sin entrada → último valor conocido (proyección plana); default abril 2026 (preserva el
 *  comportamiento histórico del 644, verificado al centavo). Recalibrar al cambiar la movilidad. */
function topeAnses(periodoYm: number): number {
  if (periodoYm >= 2026 * 12 + 5) return 4_414_652.36   // jun-2026 en adelante (recibo 06/2026)
  if (periodoYm === 2026 * 12 + 4) return 4_303_619      // may-2026
  if (periodoYm === 2026 * 12 + 3) return 4_162_912.55  // abr-2026
  if (periodoYm === 2026 * 12 + 2) return 4_045_590.45  // mar-2026
  return 4_162_912.55                                    // default
}

/** Impuesto a las Ganancias (4ª cat.) — recta efectiva calibrada a los recibos 04-05/2026.
 *  Ganancias nominal = MARGINAL × max(0, baseImponible − UMBRAL), base = remunerativo − aportes de ley.
 *  El recibo reintegra exacto la MITAD como no-remunerativo "Vianda complementaria IG" (cód 42100), por
 *  lo que el impacto neto sobre el cobro es −Ganancias/2. NO modela devoluciones/ajustes anuales ni SAC.
 *  Recalibrar (2 puntos → recta) cuando haya nuevos recibos. */
const GANANCIAS_MARGINAL = 0.27632
const GANANCIAS_UMBRAL = 6_258_045

/** Conteo de viandas por día (calibrado recibos 04-05/2026; conteo operativo, aproximado). */
const VIANDA_ADIC_FACTOR = 1.85  // viandas adicionales por día de campo
const DESAYUNO_FACTOR = 1.5      // desayunos/meriendas por día trabajado

// CCT 644/12 — escenario fijo de WENLEN (servicios especiales en Vaca Muerta).
// Verificado contra 13 recibos (mar-2025 → abr-2026): el operario SIEMPRE cobra
// turno 33%, zona Vaca Muerta y desarraigo 20%. Por eso el estimado privado se
// calcula sólo con el básico (igual que jerárquicos). Si la situación cambia, tocar acá.
const PRIV_TURNO: TipoTurno = 'TURNO_S' // serv. especiales = 33% (en el recibo figura "turno A", mismo 0,33)
const PRIV_ZONA_VM = true               // Añelo / Rincón de los Sauces = Vaca Muerta (+85% desde 11/2025)
const PRIV_TASA_DESARRAIGO = 0.20       // "Desarraigo 20%" (cód. 191) en los 13 recibos

export const CONVENIOS: { key: Convenio; label: string; divisor: number }[] = [
  { key: 'CCT_637_11', label: 'CCT 637/11 · Jerárquicos', divisor: 151.045 },
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

// El admin puede habilitar la proyección salarial a un usuario puntual desde la nube (campo
// `salaryUnlock` en su mensaje individual). App.tsx lo lee al abrir y lo persiste localmente acá; el
// gate de la pantalla lo respeta. Es obfuscación del cliente (igual que el resto), no auth real.
const SALARY_ADMIN_KEY = 'planilla-salary-admin'
export function salarioDesbloqueadoNube(): boolean {
  try { return localStorage.getItem(SALARY_ADMIN_KEY) === '1' } catch { return false }
}
export function marcarSalarioDesbloqueadoNube(activo: boolean): void {
  try {
    if (activo) localStorage.setItem(SALARY_ADMIN_KEY, '1')
    else localStorage.removeItem(SALARY_ADMIN_KEY)
  } catch { /* ignore */ }
}

// ─── Gate de la pantalla de admin (padrón) ───────────────────────────────────
// Identidad sentinela para desbloquear SÓLO la pantalla de admin (no el salario): nombre
// "Nicolas Vazquez" + código "000000". Combinado con el gesto de 3 toques al caracol.
const ADMIN_NOMBRE = normalizar('Nicolas Vazquez')
/** Código de respaldo canónico del admin: es a la vez su código real y la llave del gate de admin. */
export const CODIGO_ADMIN = '000000'
export function esAdminNube(nombre: string | undefined | null, codigo: string | undefined | null): boolean {
  return esNombreAdmin(nombre) && (codigo ?? '').trim() === CODIGO_ADMIN
}

/** ¿El nombre corresponde a la identidad del admin (ignora acentos/mayúsculas/espacios)? */
export function esNombreAdmin(nombre: string | undefined | null): boolean {
  return normalizar(nombre ?? '') === ADMIN_NOMBRE
}

/**
 * ¿Hay que re-anclar el código de respaldo del admin? true sólo si el nombre es el del admin y el
 * código está vacío. Auto-sana el caso en que el 000000 desaparece (lo que dejaría al admin sin poder
 * re-desbloquear su pantalla, ya que esAdminNube exige código "000000").
 */
export function debeReanclarCodigoAdmin(
  nombre: string | undefined | null, codigo: string | undefined | null,
): boolean {
  return esNombreAdmin(nombre) && (codigo ?? '').trim() === ''
}

// SEGUNDO factor del admin = LOGIN REAL con Firebase Auth (ver cloud-backup.loginAdmin). El gesto del
// caracol (3 toques) sólo abre el formulario de login cuando se cumple esAdminNube (Nicolas + 000000);
// la autoridad la dan las reglas de Firestore (request.auth.uid). Se retiró el código hasheado anterior.

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

// ─── Adicionales y retenciones personales (configurables por el usuario) ──────
/** Adicional propio del recibo (ej. "mayor función"). monto = esPorcentajeBasico ? básico×valor/100
 *  : valor fijo en $. Si remunerativo=true entra a los ítems fijos ANTES de la base imponible
 *  (tributa aportes/sindical); si no, va al bloque no remunerativo. */
export interface AdicionalPersonal {
  nombre: string
  esPorcentajeBasico: boolean  // true = % del sueldo básico; false = monto fijo en $
  valor: number                // porcentaje (ej. 10) o pesos, según esPorcentajeBasico
  remunerativo: boolean
}

/** Base sobre la que se calcula una retención personal porcentual. */
export type BaseRetencion = 'NETO' | 'REMUNERATIVO' | 'REMUNERATIVO_NETO' | 'BASICO' | 'BRUTO'

/** Retención propia (ej. cuota alimentaria). Se aplica AL FINAL del cálculo, después de los
 *  aportes de ley y Ganancias: monto = esPorcentaje ? base×valor/100 : valor fijo en $.
 *  Se agrega como ítem de retención con su nombre y se descuenta del neto. */
export interface RetencionPersonal {
  nombre: string
  esPorcentaje: boolean
  valor: number
  base: BaseRetencion
}

export const BASES_RETENCION: { key: BaseRetencion; label: string }[] = [
  { key: 'NETO', label: 'Neto (bruto − ret. de ley)' },
  { key: 'REMUNERATIVO', label: 'Remunerativo' },
  { key: 'REMUNERATIVO_NETO', label: 'Remunerativo − ret. de ley' },
  { key: 'BASICO', label: 'Sueldo básico' },
  { key: 'BRUTO', label: 'Bruto total' },
]

// ─── Config ──────────────────────────────────────────────────────────────────
export interface SalaryConfig {
  convenio: Convenio
  sueldoBasico: number
  antiguedadAnios: number
  tipoTurno: TipoTurno
  zonaVacaMuerta: boolean
  tasaDesarraigo644: number // 0 / 0,10 / 0,20
  lineaTrabajo: LineaTrabajo // SBDP suma 12 h al 50% por día de Campo
  adicionalesPersonales: AdicionalPersonal[]   // ítems propios (códigos sintéticos PERS-A*)
  retencionesPersonales: RetencionPersonal[]   // descuentos propios (códigos sintéticos PERS-R*)
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
    adicionalesPersonales: s.adicionalesPersonales ?? [],
    retencionesPersonales: s.retencionesPersonales ?? [],
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
    if (esDiaNoTrabajado(reg) || reg.esAusenciaJustificada || reg.esVacaciones) continue // vacaciones: paga, no se trabaja
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

// ─── Ítems personales (códigos sintéticos PERS-A* / PERS-R*) ──────────────────
/** Adicionales personales de un tipo (remunerativos o no): % del básico o monto fijo.
 *  Filas sin nombre o con monto ≤ 0 se ignoran (borradores de la config). */
function itemsAdicionalesPersonales(adicionales: AdicionalPersonal[], basico: number, remunerativos: boolean): LineItem[] {
  const items: LineItem[] = []
  adicionales.forEach((a, i) => {
    if (a.remunerativo !== remunerativos) return
    const monto = a.esPorcentajeBasico ? basico * (a.valor / 100) : a.valor
    if (!a.nombre?.trim() || !(monto > 0)) return
    items.push({ codigo: `PERS-A${i}`, concepto: a.nombre.trim(), monto })
  })
  return items
}

/** Retenciones personales (ej. cuota alimentaria): se aplican AL FINAL, después de los aportes
 *  de ley y Ganancias, sobre la base elegida. Filas sin nombre o con monto ≤ 0 se ignoran. */
function itemsRetencionesPersonales(retenciones: RetencionPersonal[], bases: Record<BaseRetencion, number>): LineItem[] {
  const items: LineItem[] = []
  retenciones.forEach((r, i) => {
    const monto = r.esPorcentaje ? bases[r.base] * (r.valor / 100) : r.valor
    if (!r.nombre?.trim() || !(monto > 0)) return
    items.push({ codigo: `PERS-R${i}`, concepto: r.nombre.trim(), monto })
  })
  return items
}

/** Bases disponibles para una retención personal porcentual (mismas en ambos convenios). */
function basesRetencion(bruto: number, retencionesLey: number, biRaw: number, basico: number): Record<BaseRetencion, number> {
  return {
    NETO: bruto - retencionesLey,               // neto antes de esta retención
    REMUNERATIVO: biRaw,                        // base imponible sin tope
    REMUNERATIVO_NETO: biRaw - retencionesLey,  // remunerativo − retenciones de ley
    BASICO: basico,
    BRUTO: bruto,
  }
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
  // Mes de cierre del período (día más tardío cargado ≈ el 20/18/15) → tramo de actas + tope ANSES vigentes.
  const maxMs = registros.reduce((m, r) => Math.max(m, r.fechaMs), 0)
  const d = new Date(maxMs)
  const periodoYm = maxMs > 0 ? d.getFullYear() * 12 + d.getMonth() : 0
  if (config.convenio === 'CCT_644_12') return calcular644(config, agg, periodoYm)
  return calcular637(config, agg, periodoYm)
}

// ── CCT 637/11 — Jerárquicos (ratios verificados recibos 04-05/2026) ──
// divisor 151,045 → hora base $13.620,07 (extra 100% = $27.240,14, verificado contra recibos).
function calcular637(config: SalaryConfig, a: Agregados, periodoYm = 0): SalaryEstimate {
  const B = config.sueldoBasico
  const hb = B / 151.045

  const antiguedad = (B / 342.46) * config.antiguedadAnios
  const presentismo = B * 0.057449
  const bonoPaz = B * 0.122516
  const adicTorre = B * 0.195777
  // Actas "a cuenta" (cód 3373/3374): tramos por vigencia (suben sin que cambie el básico).
  const [ratioActa1, ratioActa2] = periodoYm >= 2026 * 12 + 4
    ? [0.41496, 0.062244]   // mayo 2026 en adelante
    : [0.392576, 0.058886]  // hasta abril 2026
  const acta1 = B * ratioActa1
  const acta2 = B * ratioActa2

  const fijoItems: LineItem[] = [
    { codigo: '3001', concepto: 'Sueldo Básico', monto: B },
    { codigo: '3010', concepto: `Antigüedad (${config.antiguedadAnios} años)`, monto: antiguedad },
    { codigo: '3050', concepto: 'Presentismo', monto: presentismo },
    { codigo: '3060', concepto: 'Bono Paz Social', monto: bonoPaz },
    { codigo: '3065', concepto: 'Adicional Torre/Campo', monto: adicTorre },
    { codigo: '3373', concepto: 'Ant. Acta 9/11/22', monto: acta1 },
    { codigo: '3374', concepto: 'Ant. Acta 22/10/25', monto: acta2 },
  ]
  // Adicionales personales remunerativos (ej. mayor función): entran a los fijos ANTES de la
  // base imponible → tributan aportes de ley y sindical, igual que el resto del remunerativo.
  fijoItems.push(...itemsAdicionalesPersonales(config.adicionalesPersonales, B, true))
  const subtotalFijos = fijoItems.reduce((s, i) => s + i.monto, 0)

  const varViaje = a.totalViaje * (hb * 0.44105)  // viaje $6.007,12 re-anclado al hb nuevo
  const varExtra50 = a.total50 * (hb * 1.5)
  const varExtra100 = a.total100 * (hb * 2.0)
  // Desarraigo: estimación calibrada por día de campo (~2,09% del básico/día ≈ $43.000). Recibos
  // 04-05/2026: abril 18 días≈$763k, mayo 27 días≈$1,17M (±1,5%). RRHH liquida el valor exacto.
  const desarraigo = a.diasCampo * B * 0.0209

  const variableItems: LineItem[] = []
  if (a.totalViaje > 0) variableItems.push({ codigo: '3130', concepto: `Horas Viaje (${fmtHs(a.totalViaje)} hs)`, monto: varViaje })
  if (a.total50 > 0) variableItems.push({ codigo: '3150', concepto: `Extras 50% (${fmtHs(a.total50)} hs)`, monto: varExtra50 })
  if (a.total100 > 0) variableItems.push({ codigo: '3155', concepto: `Extras 100% (${fmtHs(a.total100)} hs)`, monto: varExtra100 })
  if (desarraigo > 0) variableItems.push({ codigo: '3172', concepto: `Desarraigo 20% (${a.diasCampo} días)`, monto: desarraigo })
  variableItems.push(...itemsInasistencia(a.faltasInjustificadas, B, presentismo, '3500', '3501'))
  const subtotalVariables = variableItems.reduce((s, i) => s + i.monto, 0)

  const biRaw = subtotalFijos + subtotalVariables
  const biCapped = Math.min(biRaw, topeAnses(periodoYm))
  const biSindical = subtotalFijos + varViaje + varExtra50 + varExtra100

  const retencionItems: LineItem[] = [
    { codigo: '20000', concepto: 'Jubilación 11%', monto: biCapped * 0.11 },
    { codigo: '20001', concepto: 'Ley 19.032 (PAMI) 3%', monto: biCapped * 0.03 },
    { codigo: '20002', concepto: 'Obra Social 3%', monto: biCapped * 0.03 },
    { codigo: '20130', concepto: 'Cuota Sindical 2,73%', monto: biSindical * 0.0273 },
    { codigo: '20131', concepto: 'Mutual PJ 4,09%', monto: biSindical * 0.0409 },
  ]
  // Ganancias estimada (recta calibrada): base = remunerativo − aportes de ley. El recibo reintegra la
  // mitad como "Vianda complementaria IG" (cód 42100, abajo), así que el impacto neto es −ganancia/2.
  const aportesLey = retencionItems.reduce((s, i) => s + i.monto, 0)
  const ganancia = GANANCIAS_MARGINAL * Math.max(0, biRaw - aportesLey - GANANCIAS_UMBRAL)
  if (ganancia > 0) retencionItems.push({ codigo: '90000', concepto: 'Ret. Imp. Ganancias (estimada)', monto: ganancia })
  // Retenciones de ley (aportes + sindical + Ganancias): base de las retenciones personales, que
  // se agregan más abajo (necesitan el bruto ya calculado).
  const retencionesLey = retencionItems.reduce((s, i) => s + i.monto, 0)

  // Conteos calibrados a recibos 04-05/2026: ~1,85 viandas adicionales por día de campo y ~1,5
  // desayunos por día trabajado (la app contaba 1/día → subestimaba). Aproximado (conteo operativo).
  const viandasAdic = Math.round(a.diasCampo * VIANDA_ADIC_FACTOR)
  const desayunos = Math.round(a.diasTrabajados * DESAYUNO_FACTOR)
  const noRemItems: LineItem[] = [
    { codigo: '40310', concepto: `Viandas art.34 (${a.diasTrabajados} días)`, monto: a.diasTrabajados * 35849 },
    { codigo: '40316', concepto: `Desayuno y Merienda (${desayunos})`, monto: desayunos * 5262 },
  ]
  if (viandasAdic > 0) noRemItems.push({ codigo: '40312', concepto: `Viandas Adicionales (${viandasAdic})`, monto: viandasAdic * 18699 })
  // "SNR 3% Ac. Abril 2025" se pagó sólo hasta marzo 2026; desde abril 2026 ya no figura en el recibo.
  if (periodoYm > 0 && periodoYm <= 2026 * 12 + 2) {
    noRemItems.push(
      { codigo: '40497', concepto: 'SNR 3% s/remunerativo', monto: biRaw * 0.03 },
      { codigo: '40498', concepto: 'SNR 3% s/no remunerativo', monto: 3 * 14787 },
    )
  }
  // Reintegro de Ganancias (mitad de la retención), no remunerativo (cód 42100).
  if (ganancia > 0) noRemItems.push({ codigo: '42100', concepto: 'Vianda complementaria IG (estimada)', monto: ganancia / 2 })
  noRemItems.push(
    { codigo: '42220', concepto: 'Asig. Vaca Muerta', monto: 380000 },
    { codigo: '42210', concepto: 'Asig. Vianda Fija', monto: 546197 },
  )
  // Adicionales personales NO remunerativos: van al bloque no remunerativo (no tributan).
  noRemItems.push(...itemsAdicionalesPersonales(config.adicionalesPersonales, B, false))
  const subtotalNoRemunerativo = noRemItems.reduce((s, i) => s + i.monto, 0)

  const bruto = subtotalFijos + subtotalVariables + subtotalNoRemunerativo
  // Retenciones personales (ej. cuota alimentaria): AL FINAL, después de aportes de ley y Ganancias.
  retencionItems.push(...itemsRetencionesPersonales(config.retencionesPersonales, basesRetencion(bruto, retencionesLey, biRaw, B)))
  const retenciones = retencionItems.reduce((s, i) => s + i.monto, 0)
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
function calcular644(config: SalaryConfig, a: Agregados, periodoYm = 0): SalaryEstimate {
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

  // Paso 7: presentismo = 6% de todo lo demás remunerativo, INCLUIDOS los adicionales
  // personales remunerativos (ej. Mayor función). Verificado contra recibo operador 06/2026:
  // presentismo $340.603,34 = 6% de (fijos con Mayor función + variables), exacto.
  const adicionalesPersRem = itemsAdicionalesPersonales(config.adicionalesPersonales, B, true)
  const totalAdicPersRem = adicionalesPersRem.reduce((s, i) => s + i.monto, 0)
  const presentismo = 0.06 * (conformado + antiguedad + adicCampo + bonoPaz + varExtra50 + varExtra100 + varViaje + difNocturna + desarraigo + totalAdicPersRem)

  const fijoItems: LineItem[] = [{ codigo: '2', concepto: 'Sueldo Básico', monto: B }]
  if (antiguedad > 0) fijoItems.push({ codigo: '30', concepto: `Antigüedad (${config.antiguedadAnios} años)`, monto: antiguedad })
  if (turnoAdic > 0) fijoItems.push({ codigo: '18', concepto: `Diferencial ${TURNOS.find(t => t.key === PRIV_TURNO)?.label ?? ''}`, monto: turnoAdic })
  if (zonaVM > 0) fijoItems.push({ codigo: '24', concepto: 'Zona Vaca Muerta +85%', monto: zonaVM })
  // Adicionales personales remunerativos (ej. mayor función): entran a los fijos ANTES de la
  // base imponible → tributan aportes de ley y sindical, e integran la base del presentismo.
  fijoItems.push(...adicionalesPersRem)
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
  const biCapped = Math.min(biRaw, topeAnses(periodoYm))

  const retencionItems: LineItem[] = [
    { codigo: '20000', concepto: 'Jubilación 11%', monto: biCapped * 0.11 },
    { codigo: '20001', concepto: 'Ley 19.032 (PAMI) 3%', monto: biCapped * 0.03 },
    { codigo: '20002', concepto: 'Obra Social 3%', monto: biCapped * 0.03 },
    { codigo: '20100', concepto: 'Cuota Sindical 2%', monto: biRaw * 0.02 },
    { codigo: '20101', concepto: 'Cuota Solidaria 2%', monto: biRaw * 0.02 },
    { codigo: '20102', concepto: 'Mutual MEOPP 3,9%', monto: biRaw * 0.039 },
  ]
  // Retenciones de ley: base de las retenciones personales, que se agregan más abajo (necesitan el bruto).
  const retencionesLey = retencionItems.reduce((s, i) => s + i.monto, 0)

  const noRemItems: LineItem[] = [
    { codigo: '40010', concepto: `Vianda art.34 (${a.diasTrabajados} días)`, monto: a.diasTrabajados * 35849 },
    { codigo: '40016', concepto: `Desayuno y Merienda (${a.diasTrabajados} × 2)`, monto: a.diasTrabajados * 2 * 5224 },
  ]
  if (a.diasCampo > 0) noRemItems.push({ codigo: '40012', concepto: `Vianda horas extras (${a.diasCampo} × 2)`, monto: a.diasCampo * 2 * 18674 })
  noRemItems.push({ codigo: '40497', concepto: 'SNR 3% s/remunerativo', monto: biRaw * 0.03 })
  noRemItems.push({ codigo: '42210', concepto: 'Asig. Vianda Fija', monto: 546197 })
  if (PRIV_ZONA_VM) noRemItems.push({ codigo: '42220', concepto: 'Asig. Vaca Muerta', monto: 380000 })
  // Adicionales personales NO remunerativos: van al bloque no remunerativo (no tributan).
  noRemItems.push(...itemsAdicionalesPersonales(config.adicionalesPersonales, B, false))
  const subtotalNoRemunerativo = noRemItems.reduce((s, i) => s + i.monto, 0)

  const bruto = subtotalFijos + subtotalVariables + subtotalNoRemunerativo
  // Retenciones personales (ej. cuota alimentaria): AL FINAL, después de los aportes de ley.
  retencionItems.push(...itemsRetencionesPersonales(config.retencionesPersonales, basesRetencion(bruto, retencionesLey, biRaw, B)))
  const retenciones = retencionItems.reduce((s, i) => s + i.monto, 0)
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

/**
 * Proyección del neto al fin del período. Los conceptos FIJOS (básico, antigüedad, presentismo,
 * bonos, actas) son mensuales y NO escalan con días; las VARIABLES (extras, viaje, desarraigo) y los
 * no-remunerativos per-día escalan linealmente con los días trabajados; las retenciones escalan con
 * la base imponible proyectada. Espeja la lógica de EquipTrack (HorasAnalyticsScreen).
 */
export function proyectarNeto(est: SalaryEstimate, diasTrabajadosTotales: number): number {
  if (est.diasTrabajados <= 0) return est.netoEstimado
  const diasTot = Math.max(est.diasTrabajados, diasTrabajadosTotales)
  const factor = diasTot / est.diasTrabajados
  const variablesProy = est.subtotalVariables * factor
  // 403xx = códigos per-día CCT 637/11; 400xx = CCT 644/12 (viandas/desayuno/vianda extra).
  const perDiaCodes = new Set(['40310', '40316', '40312', '40010', '40016', '40012'])
  const noRemPerDia = est.noRemItems.filter(i => perDiaCodes.has(i.codigo)).reduce((s, i) => s + i.monto, 0)
  const noRemBiLinked = est.noRemItems.find(i => i.codigo === '40497')?.monto ?? 0  // SNR 3% s/rem (≤ mar-2026)
  const noRemFija = est.subtotalNoRemunerativo - noRemPerDia - noRemBiLinked
  const brutoProy = est.subtotalFijos + variablesProy
  const biRawActual = est.baseImponibleRaw > 0 ? est.baseImponibleRaw : (est.subtotalFijos + est.subtotalVariables)
  const biLinkedRate = biRawActual > 0 ? noRemBiLinked / biRawActual : 0
  const noRemProy = noRemPerDia * factor + noRemFija + brutoProy * biLinkedRate
  const retencionesProy = biRawActual > 0 ? est.retenciones * (brutoProy / biRawActual) : est.retenciones
  return brutoProy - retencionesProy + noRemProy
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
