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
 *  - SBDP: arreglo especial — cada día de CAMPO suma SIEMPRE 12 h al 50% (además de las
 *    horas trabajadas, con tope de 8 normales), sin importar cuántas horas se trabajaron
 *    (3, 12, 16 o 24 hs → siempre las horas trabajadas hasta 8 normales + 12 al 50%).
 */
export type LineaTrabajo = 'SURFACE_WELL_TESTING' | 'SBDP' | 'FRACTURA'

export const LINEAS_TRABAJO: { key: LineaTrabajo; label: string; desc: string }[] = [
  { key: 'SURFACE_WELL_TESTING', label: 'Surface Well Testing', desc: 'Conteo estándar de horas.' },
  { key: 'SBDP', label: 'SBDP', desc: 'En Campo suma siempre 12 h al 50% (además de las trabajadas).' },
  { key: 'FRACTURA', label: 'Fractura', desc: 'Conteo estándar de horas.' },
]

/** Horas fijas al 50% que el arreglo SBDP agrega por cada día de CAMPO trabajado. */
const SBDP_CAMPO_EXTRA_50 = 12

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

/**
 * ¿El turno principal cruza la medianoche? (turno noche: la salida tiene una hora
 * de reloj menor que la entrada, p. ej. 19:00 → 07:00). Se usa para avisar, en el
 * día siguiente, que esas horas de la madrugada ya quedaron contadas en este día.
 */
export function turnoCruzaMedianoche(reg: RegistroHoras): boolean {
  const e = reg.entradaInicioMs
  const s = reg.salidaInicioMs
  if (e == null || s == null) return false
  const eMin = new Date(e).getHours() * 60 + new Date(e).getMinutes()
  const sMin = new Date(s).getHours() * 60 + new Date(s).getMinutes()
  return sMin < eMin
}

/**
 * Calculate hours for a single day record.
 * Rules (mirroring the official planilla formula + CalculoSalarialUtil):
 * - Franco / Ausencia / Feriado (no trabajado) → 0 hours
 * - Total = (turno1 + turno2) − (1 h almuerzo si lugar = Base), topeado a [0, 16]
 * - FrancoTrabajado o FeriadoTrabajado → todo al 100%
 * - Día normal: hasta 8 h → normales, > 8 h → al 50% (nunca al 100%)
 * - Línea SBDP, día de CAMPO trabajado → 8 h normales (o las trabajadas si < 8) + 12 h
 *   al 50% FIJAS (el arreglo no depende de las horas reales). Feriado/franco trabajado
 *   mantienen el 100% (paga más que el arreglo).
 */
export function calcularHorasDia(
  reg: RegistroHoras,
  linea: LineaTrabajo = 'SURFACE_WELL_TESTING',
): Pick<ResumenDia, 'horasTrabajadas' | 'horasNormales' | 'horasAl50' | 'horasAl100'> {
  if (esDiaNoTrabajado(reg) || reg.esAusenciaJustificada) {
    return { horasTrabajadas: 0, horasNormales: 0, horasAl50: 0, horasAl100: 0 }
  }

  const rawMin =
    minutesBetween(reg.entradaInicioMs, reg.salidaInicioMs) +
    minutesBetween(reg.entradaFinMs, reg.salidaFinMs)
  // Almuerzo: 1 h descontada UNA vez por día en Base (igual que la fórmula del template).
  const almuerzo = reg.lugarTrabajo === 'Base' ? 1 : 0
  const total = clamp(rawMin / 60 - almuerzo, 0, MAX_HORAS_DIA)

  // Feriado trabajado o Franco trabajado → todo al 100%
  if (reg.esFeriadoTrabajado || reg.esFrancoTrabajado) {
    return { horasTrabajadas: total, horasNormales: 0, horasAl50: 0, horasAl100: total }
  }

  // Arreglo SBDP: en CAMPO se suman SIEMPRE 12 h al 50% (además de las horas trabajadas,
  // con tope de 8 normales), sin importar cuántas se trabajaron. El total puede superar
  // las 16 h porque es un acuerdo de liquidación, no las horas reales de reloj.
  if (linea === 'SBDP' && reg.lugarTrabajo === 'Campo' && total > 0) {
    const horasNormales = Math.min(total, 8)
    return {
      horasTrabajadas: horasNormales + SBDP_CAMPO_EXTRA_50,
      horasNormales,
      horasAl50: SBDP_CAMPO_EXTRA_50,
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
    horasViaje += reg.horasViaje ?? 0
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
