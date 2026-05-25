// Hour calculation logic ported from CalculoSalarialUtil.kt
// Determines normal hours, hours at 50% extra, hours at 100% extra

import type { RegistroHoras } from '../db/database'

/** Minutes between two timestamps; null-safe → 0; handles overnight (b < a) */
function minutesBetween(a: number | null | undefined, b: number | null | undefined): number {
  if (!a || !b) return 0
  let diff = b - a
  if (diff < 0) diff += 24 * 60 * 60 * 1000 // overnight shift (e.g. 20:00 → 08:00 next day)
  return diff / 60_000
}

/** Effective worked hours for a single shift window, applying lunch deduction for Base */
function horasEfectivasTurno(
  entrada: number | null | undefined,
  salida: number | null | undefined,
  lugar: string,
): number {
  const raw = minutesBetween(entrada, salida)
  if (raw <= 0) return 0
  // Base: deduct 60 min for shifts ≥ 4h (lunch break convention)
  const deduccion = lugar === 'Base' && raw >= 240 ? 60 : 0
  return Math.max(0, raw - deduccion) / 60
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
 * Rules (mirroring CalculoSalarialUtil):
 * - Franco / Ausencia / Feriado (no trabajado) → 0 hours
 * - FrancoTrabajado or FeriadoTrabajado → 100% extra
 * - Regular day: first 8h → normal, 8-10h → 50%, >10h → 100%
 */
export function calcularHorasDia(reg: RegistroHoras): Pick<ResumenDia, 'horasTrabajadas' | 'horasNormales' | 'horasAl50' | 'horasAl100'> {
  if (esDiaNoTrabajado(reg) || reg.esAusenciaJustificada) {
    return { horasTrabajadas: 0, horasNormales: 0, horasAl50: 0, horasAl100: 0 }
  }

  const h1 = horasEfectivasTurno(reg.entradaInicioMs, reg.salidaInicioMs, reg.lugarTrabajo)
  const h2 = horasEfectivasTurno(reg.entradaFinMs, reg.salidaFinMs, reg.lugarTrabajo)
  const total = h1 + h2

  // Feriado trabajado or Franco trabajado → everything at 100%
  if (reg.esFeriadoTrabajado || reg.esFrancoTrabajado) {
    return { horasTrabajadas: total, horasNormales: 0, horasAl50: 0, horasAl100: total }
  }

  // Regular workday tiering: 0–12h normal, >12h at 50%, never 100%
  const normales = Math.min(total, 12)
  const al50 = total > 12 ? total - 12 : 0
  const al100 = 0

  return { horasTrabajadas: total, horasNormales: normales, horasAl50: al50, horasAl100: al100 }
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
