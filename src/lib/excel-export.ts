// Excel export — Normal mode (writes data into the original template_horas.xlsx)
// Mirrors ExcelHorasGenerator.kt exactly: same cell positions, same logic, same rounding.
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

// Matches Kotlin calcularHoras: Base -1h if shift >4h, result rounded to whole hours.
function calcHoras(inicioMs: number | null | undefined, finMs: number | null | undefined, lugar: string): number {
  if (!inicioMs || !finMs) return 0
  let hs = (finMs - inicioMs) / 3_600_000
  if (hs < 0) hs += 24
  if (lugar === 'Base' && hs > 4.0) hs -= 1.0
  return Math.round(hs)
}

function sc(ws: XLSX.WorkSheet, r: number, c: number, v: string | number) {
  ws[XLSX.utils.encode_cell({ r, c })] = typeof v === 'number' ? { v, t: 'n' } : { v, t: 's' }
}

function escribirFila(
  ws: XLSX.WorkSheet,
  rowIdx: number,
  dia: Date,
  reg: RegistroHoras | undefined,
  diagramaLabel: string,
) {
  sc(ws, rowIdx, 1, fmtDate(dia))

  const dow = dia.getDay()
  const isWeekend = dow === 0 || dow === 6

  if (reg == null) {
    // Lunes–Viernes: weekends auto-marked as franco
    const esLV = !diagramaLabel || diagramaLabel.toLowerCase().includes('lun')
    if (isWeekend && esLV) {
      sc(ws, rowIdx, 2, '-'); sc(ws, rowIdx, 3, ''); sc(ws, rowIdx, 4, ''); sc(ws, rowIdx, 5, '-')
      sc(ws, rowIdx, 6, 0); sc(ws, rowIdx, 7, '-'); sc(ws, rowIdx, 8, '')
      sc(ws, rowIdx, 9, '-'); sc(ws, rowIdx, 10, '-'); sc(ws, rowIdx, 11, '-'); sc(ws, rowIdx, 12, '-')
      sc(ws, rowIdx, 13, 'franco')
    } else {
      for (let c = 2; c <= 5; c++) sc(ws, rowIdx, c, '')
      sc(ws, rowIdx, 6, 0)
      for (let c = 7; c <= 13; c++) sc(ws, rowIdx, c, '')
    }
    return
  }

  if (reg.lugarTrabajo === 'Franco') {
    // Feriado trabajado: lugarTrabajo='Franco' + esFeriadoTrabajado + has time entries
    const isFeriadoTrabajado = reg.esFeriadoTrabajado && reg.entradaInicioMs != null
    if (isFeriadoTrabajado) {
      const hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
      if (!hasTurno2) {
        sc(ws, rowIdx, 2, fmt(reg.entradaInicioMs)); sc(ws, rowIdx, 3, '')
        sc(ws, rowIdx, 4, ''); sc(ws, rowIdx, 5, fmt(reg.salidaInicioMs))
      } else {
        sc(ws, rowIdx, 2, fmt(reg.entradaInicioMs)); sc(ws, rowIdx, 3, fmt(reg.salidaInicioMs))
        sc(ws, rowIdx, 4, fmt(reg.entradaFinMs)); sc(ws, rowIdx, 5, fmt(reg.salidaFinMs))
      }
      // No deduction on holidays (Campo equiv)
      const h1 = calcHoras(reg.entradaInicioMs, reg.salidaInicioMs, 'Campo')
      const h2 = calcHoras(reg.entradaFinMs, reg.salidaFinMs, 'Campo')
      sc(ws, rowIdx, 6, h1 + h2)
      sc(ws, rowIdx, 7, reg.horasViaje > 0 ? 'SI' : 'NO')
      sc(ws, rowIdx, 8, '')  // lugar empty for feriado trabajado
      sc(ws, rowIdx, 9, ''); sc(ws, rowIdx, 10, ''); sc(ws, rowIdx, 11, ''); sc(ws, rowIdx, 12, '')
      sc(ws, rowIdx, 13, 'feriado trabajado')
    } else {
      // Day off: franco / feriado / ausencia / franco (comp.)
      const etiqueta = reg.esAusenciaJustificada ? 'ausencia just.'
        : reg.esFeriado ? 'feriado'
        : reg.esFrancoCompensatorio ? 'franco (comp.)'
        : 'franco'
      sc(ws, rowIdx, 2, '-'); sc(ws, rowIdx, 3, ''); sc(ws, rowIdx, 4, ''); sc(ws, rowIdx, 5, '-')
      sc(ws, rowIdx, 6, 0); sc(ws, rowIdx, 7, '-'); sc(ws, rowIdx, 8, '')
      sc(ws, rowIdx, 9, '-'); sc(ws, rowIdx, 10, '-'); sc(ws, rowIdx, 11, '-'); sc(ws, rowIdx, 12, '-')
      sc(ws, rowIdx, 13, etiqueta + (reg.observaciones ? ` - ${reg.observaciones}` : ''))
    }
    return
  }

  // Normal workday (Base or Campo)
  const hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
  if (!hasTurno2) {
    sc(ws, rowIdx, 2, fmt(reg.entradaInicioMs)); sc(ws, rowIdx, 3, '')
    sc(ws, rowIdx, 4, ''); sc(ws, rowIdx, 5, fmt(reg.salidaInicioMs))
  } else {
    sc(ws, rowIdx, 2, fmt(reg.entradaInicioMs)); sc(ws, rowIdx, 3, fmt(reg.salidaInicioMs))
    sc(ws, rowIdx, 4, fmt(reg.entradaFinMs)); sc(ws, rowIdx, 5, fmt(reg.salidaFinMs))
  }
  const h1 = calcHoras(reg.entradaInicioMs, reg.salidaInicioMs, reg.lugarTrabajo)
  const h2 = calcHoras(reg.entradaFinMs, reg.salidaFinMs, reg.lugarTrabajo)
  sc(ws, rowIdx, 6, h1 + h2)
  sc(ws, rowIdx, 7, reg.horasViaje > 0 ? 'SI' : 'NO')
  sc(ws, rowIdx, 8, reg.lugarTrabajo)
  sc(ws, rowIdx, 9, reg.pernocte === 'Hotel' ? 'x' : '')
  sc(ws, rowIdx, 10, reg.pernocte === 'Trailer' ? 'x' : '')
  sc(ws, rowIdx, 11, reg.pernocte === 'NO' ? 'x' : '')
  sc(ws, rowIdx, 12, reg.maneja ? 'x' : '')
  let obs = reg.observaciones ?? ''
  if (reg.proyecto) obs = obs ? `${reg.proyecto} - ${obs}` : reg.proyecto
  if (reg.esFrancoTrabajado) obs = `franco trabajado${obs ? ' - ' + obs : ''}`
  sc(ws, rowIdx, 13, obs)
}

export async function exportarExcelNormal(
  mes: number,
  anio: number,
  registros: RegistroHoras[],
  nombreUsuario: string,
  diagramaLabel: string,
): Promise<void> {
  const resp = await fetch(`${import.meta.env.BASE_URL}template_horas.xlsx`)
  if (!resp.ok) throw new Error(`No se pudo cargar el template: ${resp.status}`)
  const workbook = XLSX.read(new Uint8Array(await resp.arrayBuffer()), { type: 'array' })
  const ws = workbook.Sheets[workbook.SheetNames[0]]

  const mesAnterior = MESES_ES[mes === 0 ? 11 : mes - 1]
  const mesActual = MESES_ES[mes]

  // Row 5 (idx 4), Col C (idx 2): employee name
  if (nombreUsuario) sc(ws, 4, 2, nombreUsuario)

  // Row 7 (idx 6), Col C (idx 2): period   Col I (idx 8): diagrama
  sc(ws, 6, 2, `${mesAnterior.toLowerCase()}-${mesActual.toLowerCase()} ${anio}`)
  if (diagramaLabel) sc(ws, 6, 8, `Diagrama:    ${diagramaLabel}`)

  const byDay = new Map(registros.map(r => {
    const d = new Date(r.fechaMs)
    return [`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, r]
  }))

  let dataRowIdx = 11  // data starts at row 12 in the template (0-indexed = 11)
  const cur = new Date(periodoStart(mes, anio))
  const end = periodoEnd(mes, anio)
  while (cur <= end) {
    escribirFila(ws, dataRowIdx, new Date(cur), byDay.get(`${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`), diagramaLabel)
    dataRowIdx++
    cur.setDate(cur.getDate() + 1)
  }

  // Clear leftover rows from template (months shorter than 31 days)
  for (let i = dataRowIdx; i < 11 + 31; i++) {
    for (let c = 1; c <= 13; c++) sc(ws, i, c, '')
  }

  const safeName = (nombreUsuario || 'Planilla').replace(/[/\\:*?"<>|]/g, '_')
  XLSX.writeFile(workbook, `Planilla de horas ${safeName} (${mesAnterior} - ${mesActual} - ${anio}).xlsx`)
}
