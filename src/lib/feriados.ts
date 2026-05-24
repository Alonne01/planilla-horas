// Feriados Nacionales Argentina 2025-2026 (ported from CalculoSalarialUtil.kt)
const FERIADOS = new Set([
  '2025-01-01', '2025-03-03', '2025-03-04', '2025-04-02',
  '2025-04-17', '2025-04-18', '2025-05-01', '2025-05-25',
  '2025-06-20', '2025-07-09', '2025-08-17', '2025-10-12',
  '2025-11-20', '2025-11-21', '2025-12-08', '2025-12-25',
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-02',
  '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-20',
  '2026-07-09', '2026-08-17', '2026-10-12', '2026-11-20',
  '2026-12-08', '2026-12-25',
])

export function esFeriadoNacional(fechaMs: number): boolean {
  const d = new Date(fechaMs)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return FERIADOS.has(key)
}
