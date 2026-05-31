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
 * Calculate hours for a single day record.
 * Rules (mirroring the official planilla formula + CalculoSalarialUtil):
 * - Franco / Ausencia / Feriado (no trabajado) → 0 hours
 * - Total = (turno1 + turno2) − (1 h almuerzo si lugar = Base), topeado a [0, 16]
 * - FrancoTrabajado o FeriadoTrabajado → todo al 100%
 * - Día normal: hasta 8 h → normales, > 8 h → al 50% (nunca al 100%)
 */
export function calcularHorasDia(reg: RegistroHoras): Pick<ResumenDia, 'horasTrabajadas' | 'horasNormales' | 'horasAl50' | 'horasAl100'> {
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

  // Día normal: 0–8 h normales, > 8 h al 50%, nunca al 100%
  const horasNormales = Math.min(total, 8)
  const horasAl50 = total > 8 ? total - 8 : 0

  return { horasTrabajadas: total, horasNormales, horasAl50, horasAl100: 0 }
}

export function calcularResumenPeriodo(registros: RegistroHoras[]): ResumenHoras {
  let horasNormales = 0
  let horasAl50 = 0
  let horasAl100 = 0
  let horasViaje = 0

  for (const reg of registros) {
    const h = calcularHorasDia(reg)
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

export function resumenDia(reg: RegistroHoras): ResumenDia {
  const h = calcularHorasDia(reg)
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
