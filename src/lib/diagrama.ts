// Ported from DiagramaPattern enum + esFrancoPorDiagrama() in HorasTrabajoViewModel.kt

import { esFeriadoNacional } from './feriados'

export type DiagramaPatternKey = 'LUNES_VIERNES' | 'D10X5' | 'D7X7' | 'D10X4'

export interface DiagramaPattern {
  key: DiagramaPatternKey
  label: string
  diasTrabajo: number
  diasFranco: number
}

export const DIAGRAMAS: DiagramaPattern[] = [
  { key: 'LUNES_VIERNES', label: 'Lunes a Viernes', diasTrabajo: 5, diasFranco: 2 },
  { key: 'D10X5',         label: '10 × 5',          diasTrabajo: 10, diasFranco: 5 },
  { key: 'D7X7',          label: '7 × 7',            diasTrabajo: 7,  diasFranco: 7 },
  { key: 'D10X4',         label: '10 × 4',           diasTrabajo: 10, diasFranco: 4 },
]

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function esFrancoPorDiagrama(
  fechaMs: number,
  diagramaKey: DiagramaPatternKey,
  diagramaInicioMs: number,
): boolean {
  if (diagramaKey === 'LUNES_VIERNES') {
    const dow = new Date(fechaMs).getDay()
    return dow === 0 || dow === 6
  }
  if (diagramaInicioMs <= 0) return false
  const pattern = DIAGRAMAS.find(d => d.key === diagramaKey)!
  const totalCiclo = pattern.diasTrabajo + pattern.diasFranco
  const fechaDay = startOfDay(fechaMs)
  const inicioDay = startOfDay(diagramaInicioMs)
  const diffDays = Math.round((fechaDay - inicioDay) / 86_400_000)
  const pos = ((diffDays % totalCiclo) + totalCiclo) % totalCiclo
  return pos >= pattern.diasTrabajo
}

/**
 * Día de cierre del período que termina en el mes `mes`/`anio` (0-indexed).
 * Histórico hasta junio 2026: 20. Transición: julio 2026 cierra el 18, y desde agosto 2026
 * en adelante el 15 (período "16 al 15"). Como el inicio de cada período es el día siguiente
 * al cierre del anterior, la transición 19/7 → 15/8 sale sola.
 */
export function diaCierre(mes: number, anio: number): number {
  const ym = anio * 12 + mes
  if (ym <= 2026 * 12 + 5) return 20   // hasta junio 2026 (mes 5)
  if (ym === 2026 * 12 + 6) return 18  // julio 2026 (mes 6)
  return 15                             // agosto 2026 (mes 7) en adelante
}

/** Período "vigente" hoy: si hoy ya pasó el cierre de este mes, es el del mes siguiente. */
export function defaultPeriodoMes(): number {
  const d = new Date()
  const m = d.getMonth()
  return d.getDate() > diaCierre(m, d.getFullYear()) ? (m + 1) % 12 : m
}

export function defaultPeriodoAnio(): number {
  const d = new Date()
  const m = d.getMonth()
  const y = d.getFullYear()
  return d.getDate() > diaCierre(m, y) && m === 11 ? y + 1 : y
}

/** Inicio del período = día siguiente al cierre del período anterior. */
export function periodoStart(mes: number, anio: number): Date {
  const prevMes = mes === 0 ? 11 : mes - 1
  const prevAnio = mes === 0 ? anio - 1 : anio
  const prevEnd = periodoEnd(prevMes, prevAnio)
  return new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() + 1)
}

/** Fin del período = día de cierre de ese mes. */
export function periodoEnd(mes: number, anio: number): Date {
  return new Date(anio, mes, diaCierre(mes, anio))
}

/**
 * Fecha de cobro de un período: el 4º día hábil del mes siguiente al cierre
 * (saltea sábados, domingos y feriados nacionales).
 */
export function fechaCobro(mes: number, anio: number): Date {
  const payMes = mes === 11 ? 0 : mes + 1
  const payAnio = mes === 11 ? anio + 1 : anio
  const d = new Date(payAnio, payMes, 1)
  let habiles = 0
  for (;;) {
    const dow = d.getDay()
    const ms = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).getTime()
    if (dow !== 0 && dow !== 6 && !esFeriadoNacional(ms)) {
      habiles++
      if (habiles === 4) return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    }
    d.setDate(d.getDate() + 1)
  }
}

/** Array of all dates in the period sorted chronologically */
export function diasDelPeriodo(mes: number, anio: number): Date[] {
  const start = periodoStart(mes, anio)
  const end = periodoEnd(mes, anio)
  const days: Date[] = []
  const cur = new Date(start)
  while (cur <= end) {
    days.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** Período sentinela para el tutorial: una "planilla de prueba" aislada que no colisiona con datos reales. */
export const PERIODO_PRUEBA = { mes: 0, anio: 2999 }
/** Cualquier registro con fechaMs ≥ esto es dato de prueba del tutorial (para limpiarlo al salir). */
export const PRUEBA_CUTOFF_MS = new Date(2998, 11, 1).getTime()
