// Excel export — Completo mode (total hours per day + breakdown normal/50%/100%)
import * as XLSX from 'xlsx'
import type { RegistroHoras } from '../db/database'
import { periodoStart, periodoEnd, MESES_ES } from './diagrama'
import { calcularHorasDia, esDiaNoTrabajado, type LineaTrabajo } from './calculo-horas'

function fmtDate(d: Date): string {
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  return `${dias[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function tipoLabel(reg: RegistroHoras): string {
  if (reg.esFrancoCompensatorio) return 'Franco Comp.'
  if (reg.esFrancoTrabajado) return 'Franco Trab.'
  if (reg.esFeriadoTrabajado) return 'Feriado Trab.'
  if (reg.esFaltaInjustificada) return 'Falta injust.'
  if (reg.esFeriado) return 'Feriado'
  if (reg.esAusenciaJustificada) return 'Ausencia'
  if (reg.lugarTrabajo === 'Franco') return 'Franco'
  return reg.lugarTrabajo
}

export function exportarExcelCompleto(
  mes: number,
  anio: number,
  registros: RegistroHoras[],
  nombreUsuario: string,
  linea: LineaTrabajo = 'SURFACE_WELL_TESTING',
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

  const headers = ['Fecha', 'Tipo', 'Total Hs', 'Normales', 'Al 50%', 'Al 100%', 'Hs Viaje', 'Proyecto / Observaciones']
  const rows: (string | number)[][] = [
    [`Planilla de Horas Completa — ${nombreUsuario || 'Empleado'}`],
    [`Período: ${periodoLabel}`],
    [],
    headers,
  ]

  let totNormales = 0, totAl50 = 0, totAl100 = 0, totViaje = 0

  const cur = new Date(start)
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`
    const reg = byDay.get(key)

    if (!reg) {
      rows.push([fmtDate(new Date(cur)), '', 0, 0, 0, 0, 0, ''])
    } else {
      const h = calcularHorasDia(reg, linea)
      const obs = [reg.proyecto, reg.observaciones].filter(Boolean).join(' — ')
      rows.push([
        fmtDate(new Date(cur)),
        tipoLabel(reg),
        +h.horasTrabajadas.toFixed(2),
        +h.horasNormales.toFixed(2),
        +h.horasAl50.toFixed(2),
        +h.horasAl100.toFixed(2),
        +(reg.horasViaje ?? 0).toFixed(2),
        obs,
      ])
      if (!esDiaNoTrabajado(reg)) {
        totNormales += h.horasNormales
        totAl50 += h.horasAl50
        totAl100 += h.horasAl100
        totViaje += reg.horasViaje ?? 0
      }
    }
    cur.setDate(cur.getDate() + 1)
  }

  // Totals
  rows.push([])
  rows.push([
    'TOTALES', '',
    +(totNormales + totAl50 + totAl100).toFixed(2),
    +totNormales.toFixed(2),
    +totAl50.toFixed(2),
    +totAl100.toFixed(2),
    +totViaje.toFixed(2),
    '',
  ])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 45 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle')

  const safeName = (nombreUsuario || 'Planilla').replace(/[/\\:*?"<>|]/g, '_')
  XLSX.writeFile(wb, `Planilla completa ${safeName} (${mesAnterior} - ${mesActual} - ${anio}).xlsx`)
}
