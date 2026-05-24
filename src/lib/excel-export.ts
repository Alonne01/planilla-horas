// Excel export — Normal mode (replicates the paper planilla layout)
// Ported from ExcelHorasGenerator.kt
import * as XLSX from 'xlsx'
import type { RegistroHoras } from '../db/database'
import { periodoStart, periodoEnd, MESES_ES } from './diagrama'

function fmt(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function horasTurno(ent: number | null | undefined, sal: number | null | undefined, lugar: string): number {
  if (!ent || !sal || sal <= ent) return 0
  const min = (sal - ent) / 60_000
  const desc = lugar === 'Base' && min >= 240 ? 30 : 0
  return Math.max(0, min - desc) / 60
}

function buildFila(reg: RegistroHoras | undefined, dia: Date): (string | number)[] {
  const dow = dia.getDay()
  const isWeekend = dow === 0 || dow === 6

  if (!reg) {
    const obs = isWeekend ? 'franco' : ''
    return [fmtDate(dia), '', '', '', '', 0, '', '', '', '', '', '', obs]
  }

  if (reg.lugarTrabajo === 'Franco' && !reg.esFrancoTrabajado && !reg.esFeriadoTrabajado) {
    let obs = 'franco'
    if (reg.esFrancoCompensatorio) obs = 'franco compensatorio'
    else if (reg.esFeriado) obs = 'feriado'
    else if (reg.esAusenciaJustificada) obs = 'ausencia justificada'
    return [fmtDate(dia), '-', '', '', '-', 0, '-', '', '-', '-', '-', '-', obs + (reg.observaciones ? ` - ${reg.observaciones}` : '')]
  }

  const h1 = horasTurno(reg.entradaInicioMs, reg.salidaInicioMs, reg.lugarTrabajo)
  const h2 = horasTurno(reg.entradaFinMs, reg.salidaFinMs, reg.lugarTrabajo)
  const total = h1 + h2

  const e1 = fmt(reg.entradaInicioMs)
  const s1 = fmt(reg.salidaInicioMs)
  const e2 = fmt(reg.entradaFinMs)
  const s2 = fmt(reg.salidaFinMs)
  const hasTurno2 = !!reg.entradaFinMs && !!reg.salidaFinMs

  const lugar = reg.lugarTrabajo
  const pernocte = reg.pernocte !== 'NO' ? reg.pernocte : ''
  const maneja = reg.maneja ? 'SI' : 'NO'
  const viaje = reg.horasViaje > 0 ? reg.horasViaje : ''
  let obs = reg.observaciones ?? ''
  if (reg.proyecto) obs = obs ? `${reg.proyecto} - ${obs}` : reg.proyecto
  if (reg.esFrancoTrabajado) obs = `franco trabajado${obs ? ' - ' + obs : ''}`
  if (reg.esFeriadoTrabajado) obs = `feriado trabajado${obs ? ' - ' + obs : ''}`

  if (hasTurno2) {
    return [fmtDate(dia), e1, s1, e2, s2, total, maneja, viaje, lugar, pernocte, '', '', obs]
  } else {
    return [fmtDate(dia), e1, '', '', s1, total, maneja, viaje, lugar, pernocte, '', '', obs]
  }
}

export function exportarExcelNormal(
  mes: number,
  anio: number,
  registros: RegistroHoras[],
  nombreUsuario: string,
  diagramaLabel: string,
): void {
  const byDay = new Map(registros.map(r => {
    const d = new Date(r.fechaMs)
    return [`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, r]
  }))

  const start = periodoStart(mes, anio)
  const end = periodoEnd(mes, anio)

  const mesAnterior = MESES_ES[(mes === 0 ? 11 : mes - 1)]
  const mesActual = MESES_ES[mes]
  const periodoLabel = `${mesAnterior.toLowerCase()}-${mesActual.toLowerCase()} ${anio}`

  const headers = ['Fecha', 'E1', 'S1', 'E2', 'S2', 'Horas', 'Maneja', 'Hs Viaje', 'Lugar', 'Pernocte', '', '', 'Observaciones']
  const rows: (string | number)[][] = [
    [`Planilla de Horas — ${nombreUsuario || 'Empleado'}`],
    [`Período: ${periodoLabel}`, '', '', '', '', '', '', '', `Diagrama: ${diagramaLabel}`],
    [],
    headers,
  ]

  const cur = new Date(start)
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`
    rows.push(buildFila(byDay.get(key), new Date(cur)))
    cur.setDate(cur.getDate() + 1)
  }

  // Totals row
  const dataStart = 5 // 1-indexed row where data begins (rows 1-4 = headers)
  const dataEnd = rows.length
  rows.push([
    'TOTALES', '', '', '', '',
    { f: `SUM(F${dataStart}:F${dataEnd})` } as unknown as number,
    '', { f: `SUM(H${dataStart}:H${dataEnd})` } as unknown as number,
    '', '', '', '', '',
  ])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 },
    { wch: 7 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 },
    { wch: 5 }, { wch: 5 }, { wch: 35 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planilla')

  const safeName = (nombreUsuario || 'Planilla').replace(/[/\\:*?"<>|]/g, '_')
  XLSX.writeFile(wb, `Planilla de horas ${safeName} (${mesAnterior} - ${mesActual} - ${anio}).xlsx`)
}
