// Ported from DiagramaPattern enum + esFrancoPorDiagrama() in HorasTrabajoViewModel.kt

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

/** Period 21 of previous month → 20 of current month */
export function defaultPeriodoMes(): number {
  const d = new Date()
  return d.getDate() >= 21 ? (d.getMonth() + 1) % 12 : d.getMonth()
}

export function defaultPeriodoAnio(): number {
  const d = new Date()
  if (d.getDate() >= 21 && d.getMonth() === 11) return d.getFullYear() + 1
  return d.getFullYear()
}

/** Start of the 31-day billing period (day 21 prev month to day 20 current month) */
export function periodoStart(mes: number, anio: number): Date {
  // mes is the "current" month of the period (0-indexed)
  // period starts on day 21 of the previous month
  const prev = new Date(anio, mes, 0) // last day of prev month
  return new Date(prev.getFullYear(), prev.getMonth(), 21)
}

export function periodoEnd(mes: number, anio: number): Date {
  return new Date(anio, mes, 20)
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
