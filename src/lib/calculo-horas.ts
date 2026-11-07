// Hour calculation logic ported from CalculoSalarialUtil.kt
// Determines normal hours, hours at 50% extra, hours at 100% extra.
//
// El TOTAL de horas trabajadas por día replica EXACTAMENTE la fórmula de la
// planilla oficial (col. G del template) que usa el export Normal:
//
//   total = MIN(16, (D-C)+(F-E) - (lugar=="Base" ? 1 : 0))   ; IFERROR → 0
//
// Es decir: la hora de almuerzo en Base se descuenta UNA sola vez por día (no
// por turno), el total se topea en 16 h y nunca es negativo. Así el resumen en
// pantalla, el export "Completo con horas" y el export "Normal" (planilla
// oficial) dan siempre los mismos números.

import type { RegistroHoras } from '../db/database'

const MAX_HORAS_DIA = 16

/**
 * Línea de trabajo del operario. Define cómo se cuentan las horas:
 *  - Surface Well Testing / Fractura: conteo estándar (hasta 8 h normales, el resto al 50%).
 *  - SBDP: arreglo especial — cada día de CAMPO (con o sin pernocte) cuenta SIEMPRE 12 h
 *    al 50%, SIN horas normales, sin importar cuántas horas se trabajaron (6, 8, 12 o
 *    16 hs → siempre 12 h al 50%). Trabajan "on call": los días de guardia se cargan
 *    como entró→00:00, 00:00→00:00 (24 h) o 00:00→llegada (ver el flag esOnCall del
 *    registro), pero igual liquidan 12 h al 50%.
 */
export type LineaTrabajo =
  | 'SURFACE_WELL_TESTING' | 'SBDP' | 'FRACTURA'
  | 'MANTENIMIENTO' | 'BASE' | 'PH' | 'WIRELINE' | 'ALMACEN' | 'OTRO'

export const LINEAS_TRABAJO: { key: LineaTrabajo; label: string; desc: string }[] = [
  { key: 'SURFACE_WELL_TESTING', label: 'Surface Well Testing', desc: 'Conteo estándar de horas.' },
  { key: 'SBDP', label: 'SBDP', desc: 'On call: en Campo cuenta siempre 12 h al 50% (sin horas normales).' },
  { key: 'FRACTURA', label: 'Fractura', desc: 'Conteo estándar de horas.' },
  { key: 'MANTENIMIENTO', label: 'Mantenimiento', desc: 'Conteo estándar de horas.' },
  { key: 'BASE', label: 'Base', desc: 'Conteo estándar de horas.' },
  { key: 'PH', label: 'PH', desc: 'Conteo estándar de horas.' },
  { key: 'WIRELINE', label: 'Wireline', desc: 'Conteo estándar de horas.' },
  { key: 'ALMACEN', label: 'Almacén', desc: 'Conteo estándar de horas.' },
  { key: 'OTRO', label: 'Otro', desc: 'Conteo estándar de horas.' },
]

/** Etiqueta legible de una línea (para el respaldo en la nube y la pantalla de admin). */
export function lineaLabel(key: LineaTrabajo): string {
  return LINEAS_TRABAJO.find(l => l.key === key)?.label ?? key
}

/** Horas al 50% que cuenta un día de CAMPO en SBDP (fijas, sin horas normales). */
const SBDP_CAMPO_HORAS_50 = 12

/** Minutes between two timestamps; null-safe → 0; handles overnight (b < a) */
function minutesBetween(a: number | null | undefined, b: number | null | undefined): number {
  if (!a || !b) return 0
  let diff = b - a
  if (diff < 0) diff += 24 * 60 * 60 * 1000 // overnight shift (e.g. 20:00 → 08:00 next day)
  return diff / 60_000
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export interface ResumenHoras {
  horasNormales: number
  horasAl50: number
  horasAl100: number
  horasViaje: number
  totalHorasTrabajadas: number
}

export interface ResumenDia {
  fechaMs: number
  horasTrabajadas: number
  horasNormales: number
  horasAl50: number
  horasAl100: number
  tipoDisplay: string
  observaciones: string
  proyecto: string
}

/** Whether a day's record is a day off (not worked) */
export function esDiaNoTrabajado(reg: RegistroHoras): boolean {
  return (
    reg.lugarTrabajo === 'Franco' &&
    !reg.esFrancoTrabajado &&
    !reg.esFeriadoTrabajado
  )
}

/** Minutos de reloj (0–1439) de un timestamp. */
function minDelDia(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Franjas completas (entró/salió) de un registro: la 1ª y, si hay doble franja, la 2ª. */
function franjasReg(reg: RegistroHoras): [number, number][] {
  const out: [number, number][] = []
  if (reg.entradaInicioMs != null && reg.salidaInicioMs != null) out.push([reg.entradaInicioMs, reg.salidaInicioMs])
  if (reg.entradaFinMs != null && reg.salidaFinMs != null) out.push([reg.entradaFinMs, reg.salidaFinMs])
  return out
}

/**
 * ¿El último turno del día cruza la medianoche? (turno noche: la salida tiene una hora
 * de reloj menor que la entrada, p. ej. 19:00 → 07:00). Con doble franja se mira la 2ª,
 * que es la que puede seguir de madrugada. Se usa para avisar, en el día siguiente, que
 * esas horas de la madrugada ya quedaron contadas en este día.
 */
export function turnoCruzaMedianoche(reg: RegistroHoras): boolean {
  const fr = franjasReg(reg)
  const ultima = fr[fr.length - 1]
  if (!ultima) return false
  return minDelDia(ultima[1]) < minDelDia(ultima[0])
}

/** Hora de salida (ms) del último turno del día (la 2ª franja si la hay). */
export function salidaUltimoTurno(reg: RegistroHoras): number | null {
  const fr = franjasReg(reg)
  return fr.length ? fr[fr.length - 1][1] : null
}

/** Horas totales y nocturnas (ventana 21:00–06:00) de una franja en horas de reloj. */
function horasYNocturnas(startH: number, endH: number): { total: number; noct: number; cruza: boolean } {
  let end = endH
  const cruza = end < startH
  if (cruza) end += 24
  const total = end - startH
  let noct = Math.max(0, Math.min(end, 30) - Math.max(startH, 21))
  noct += Math.max(0, Math.min(end, 6) - Math.max(startH, 0))
  return { total, noct, cruza }
}

/**
 * Clasifica el turno de un registro como 'noche' o 'dia', o null si está incompleto. Es
 * noche si alguna franja cruza la medianoche o si la mitad o más de las horas (sumando
 * ambas franjas) caen en la ventana nocturna 21:00–06:00 — mismo criterio que la nota del
 * diálogo y EquipTrack.
 */
function clasificarTurnoReg(reg: RegistroHoras): 'noche' | 'dia' | null {
  let total = 0, noct = 0, cruza = false
  for (const [e, s] of franjasReg(reg)) {
    const r = horasYNocturnas(minDelDia(e) / 60, minDelDia(s) / 60)
    total += r.total; noct += r.noct; cruza = cruza || r.cruza
  }
  if (total <= 0) return null
  return cruza || noct >= total / 2 ? 'noche' : 'dia'
}

/** "HH:MM" → minutos del día, o null si está vacío/mal formado. */
function hhmmAMin(v: string): number | null {
  if (!v) return null
  const [h, m] = v.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

export interface AnalisisDobleFranja {
  /** Error que impide guardar (franjas superpuestas, 1ª cruzando medianoche, franja de 0 h). */
  error: string | null
  horas1: number
  horas2: number
  /** Suma de ambas franjas, ANTES del almuerzo de Base y del tope de 16 h. */
  totalCrudo: number
  /** La 2ª franja termina al día siguiente (ej. 19:00 → 07:00). */
  segundaCruzaMedianoche: boolean
  /** La suma supera las 16 h: la planilla la recorta (MIN(16, ...)). */
  superaTope: boolean
}

/**
 * Valida y resume una carga en DOBLE FRANJA (entró–salió / entró–salió) dada en "HH:MM".
 * Reglas: la 1ª franja no puede cruzar la medianoche (la 2ª tiene que ir después, el mismo
 * día); la 2ª no puede empezar antes de que termine la 1ª; ninguna puede durar 0 h. La 2ª SÍ
 * puede cruzar la medianoche, pero se avisa (y si la suma pasa las 16 h, la planilla la topea).
 * Si alguna franja está incompleta devuelve todo en 0 sin error (lo marca la UI como "media carga").
 */
export function analizarDobleFranja(e1: string, s1: string, e2: string, s2: string): AnalisisDobleFranja {
  const vacio: AnalisisDobleFranja = { error: null, horas1: 0, horas2: 0, totalCrudo: 0, segundaCruzaMedianoche: false, superaTope: false }
  const [a1, b1, a2, b2] = [e1, s1, e2, s2].map(hhmmAMin)
  if (a1 == null || b1 == null || a2 == null || b2 == null) return vacio
  if (a1 === b1 || a2 === b2) return { ...vacio, error: 'Una de las franjas dura 0 h: revisá entrada y salida.' }
  if (b1 < a1) return { ...vacio, error: 'La primera franja no puede pasar la medianoche: la segunda tiene que ser después, el mismo día.' }
  if (a2 < b1) return { ...vacio, error: 'Las franjas se superponen: la segunda tiene que empezar después de que termina la primera.' }
  const horas1 = (b1 - a1) / 60
  const segundaCruzaMedianoche = b2 < a2
  const horas2 = ((segundaCruzaMedianoche ? b2 + 1440 : b2) - a2) / 60
  const totalCrudo = horas1 + horas2
  return { error: null, horas1, horas2, totalCrudo, segundaCruzaMedianoche, superaTope: totalCrudo > MAX_HORAS_DIA }
}

/**
 * Sufijo de turno trabajado ('TD' día | 'TN' noche | '') para anexar al FINAL de las
 * observaciones. SÓLO días de CAMPO: en Base siempre es día (no se anota) y las ausencias /
 * francos no trabajados no tienen horas. Devuelve '' si no aplica o el turno está incompleto.
 */
export function sufijoTurnoCampo(reg: RegistroHoras): string {
  if (reg.lugarTrabajo !== 'Campo') return ''
  const t = clasificarTurnoReg(reg)
  return t === 'noche' ? 'TN' : t === 'dia' ? 'TD' : ''
}

/**
 * Horas de viaje que se liquidan APARTE (ítem "Horas Viaje", ~47% del valor hora):
 * cuenta el valor real cargado (2, 3, 4 hs...) el día que hubo traslado (Campo, o la +1h
 * del toggle "Viaje a base"). "Manejó" NO cambia esto: igual que en EquipTrack, las horas
 * de viaje siempre van al ítem Viaje y nunca engrosan la jornada trabajada.
 */
export function horasViajeSeparadas(reg: RegistroHoras): number {
  const hv = reg.horasViaje ?? 0
  if (hv <= 0) return 0
  return hv
}

/**
 * Calculate hours for a single day record.
 * Rules (mirroring the official planilla formula + CalculoSalarialUtil):
 * - Franco / Ausencia / Feriado (no trabajado) → 0 hours
 * - Total = (turno1 + turno2) − (1 h almuerzo si lugar = Base), topeado a [0, 16]
 * - FrancoTrabajado o FeriadoTrabajado → todo al 100%
 * - Día normal: hasta 8 h → normales, > 8 h → al 50% (nunca al 100%)
 * - Línea SBDP, día de CAMPO trabajado → 12 h al 50% FIJAS, SIN horas normales (no
 *   depende de las horas reales). Feriado/franco trabajado mantienen el 100%.
 */
export function calcularHorasDia(
  reg: RegistroHoras,
  linea: LineaTrabajo = 'SURFACE_WELL_TESTING',
): Pick<ResumenDia, 'horasTrabajadas' | 'horasNormales' | 'horasAl50' | 'horasAl100'> {
  if (esDiaNoTrabajado(reg) || reg.esAusenciaJustificada || reg.esVacaciones) {
    return { horasTrabajadas: 0, horasNormales: 0, horasAl50: 0, horasAl100: 0 }
  }

  const rawMin =
    minutesBetween(reg.entradaInicioMs, reg.salidaInicioMs) +
    minutesBetween(reg.entradaFinMs, reg.salidaFinMs)
  // Almuerzo: 1 h descontada UNA vez por día en Base (igual que la fórmula del template).
  const almuerzo = reg.lugarTrabajo === 'Base' ? 1 : 0
  // Las horas de viaje NUNCA engrosan la jornada (igual que EquipTrack): aunque haya manejado,
  // se liquidan aparte en el ítem Viaje (ver horasViajeSeparadas).
  const total = clamp(rawMin / 60 - almuerzo, 0, MAX_HORAS_DIA)

  // Feriado trabajado o Franco trabajado → todo al 100%
  if (reg.esFeriadoTrabajado || reg.esFrancoTrabajado) {
    return { horasTrabajadas: total, horasNormales: 0, horasAl50: 0, horasAl100: total }
  }

  // Arreglo SBDP: en CAMPO (con o sin pernocte) se cuentan SIEMPRE 12 h al 50% y NINGUNA
  // hora normal, sin importar cuántas horas se trabajaron (6, 8, 12 o 16 → siempre 12).
  // El día "on call" completo se carga 00:00→00:00 (duración 0): el flag esOnCall lo marca
  // como guardia para que igual liquide 12 h al 50%.
  if (linea === 'SBDP' && reg.lugarTrabajo === 'Campo' && (total > 0 || reg.esOnCall)) {
    return {
      horasTrabajadas: SBDP_CAMPO_HORAS_50,
      horasNormales: 0,
      horasAl50: SBDP_CAMPO_HORAS_50,
      horasAl100: 0,
    }
  }

  // Día normal: 0–8 h normales, > 8 h al 50%, nunca al 100%
  const horasNormales = Math.min(total, 8)
  const horasAl50 = total > 8 ? total - 8 : 0

  return { horasTrabajadas: total, horasNormales, horasAl50, horasAl100: 0 }
}

export function calcularResumenPeriodo(
  registros: RegistroHoras[],
  linea: LineaTrabajo = 'SURFACE_WELL_TESTING',
): ResumenHoras {
  let horasNormales = 0
  let horasAl50 = 0
  let horasAl100 = 0
  let horasViaje = 0

  for (const reg of registros) {
    const h = calcularHorasDia(reg, linea)
    horasNormales += h.horasNormales
    horasAl50 += h.horasAl50
    horasAl100 += h.horasAl100
    horasViaje += horasViajeSeparadas(reg)
  }

  return {
    horasNormales,
    horasAl50,
    horasAl100,
    horasViaje,
    totalHorasTrabajadas: horasNormales + horasAl50 + horasAl100,
  }
}

export function resumenDia(reg: RegistroHoras, linea: LineaTrabajo = 'SURFACE_WELL_TESTING'): ResumenDia {
  const h = calcularHorasDia(reg, linea)
  let tipoDisplay: string = reg.lugarTrabajo
  if (reg.esFrancoCompensatorio) tipoDisplay = 'Franco Comp.'
  else if (reg.esFrancoTrabajado) tipoDisplay = 'Franco Trab.'
  else if (reg.esFeriadoTrabajado) tipoDisplay = 'Feriado Trab.'
  else if (reg.esFaltaInjustificada) tipoDisplay = 'Falta injust.'
  else if (reg.esVacaciones) tipoDisplay = 'Vacaciones'
  else if (reg.esFeriado) tipoDisplay = 'Feriado'
  else if (reg.esAusenciaJustificada) tipoDisplay = 'Ausencia'

  return {
    fechaMs: reg.fechaMs,
    ...h,
    tipoDisplay,
    observaciones: reg.observaciones ?? '',
    proyecto: reg.proyecto ?? '',
  }
}

/** Jornada a partir de la cual empiezan las horas extra para el conteo de viandas. */
export const VIANDA_JORNADA_HS = 8
/** Cada cuántas horas extra corresponde una vianda adicional. */
export const VIANDA_ADIC_CADA_HS = 2

/**
 * Viandas que corresponden a un día según las horas trabajadas: 1 por día trabajado (art. 34)
 * + 1 adicional por cada 2 h por encima de las 8 (12 h → 1 + 2). Coincide con los recibos
 * (2 adicionales por día de campo de 12 h). Conteo orientativo: lo liquida RRHH.
 */
export function viandasDelDia(horasTrabajadas: number): { base: number; adicionales: number } {
  if (!(horasTrabajadas > 0)) return { base: 0, adicionales: 0 }
  const extra = Math.max(0, horasTrabajadas - VIANDA_JORNADA_HS)
  return { base: 1, adicionales: Math.floor(extra / VIANDA_ADIC_CADA_HS + 1e-9) }
}
