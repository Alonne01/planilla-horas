import { useRef } from 'react'
import type { RegistroHoras } from '../db/database'
import { esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'
import { esFeriadoNacional } from '../lib/feriados'
import { calcularHorasDia, esDiaNoTrabajado } from '../lib/calculo-horas'

interface Props {
  dias: Date[]
  byDay: Map<string, RegistroHoras>
  diagrama: DiagramaPatternKey
  diagramaInicioMs: number
  onSelectDate: (d: Date) => void
  onContext?: (date: Date, x: number, y: number) => void
}

const DIAS_HEADER = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function fmt2(n: number) { return String(n).padStart(2, '0') }

/** Monday-indexed day-of-week: Mon=0 … Sun=6 */
function dowMon(d: Date) { return (d.getDay() + 6) % 7 }

function cellStyle(fecha: Date, reg: RegistroHoras | undefined, diagrama: DiagramaPatternKey, diagramaInicioMs: number) {
  const isFrancoByDiag = esFrancoPorDiagrama(fecha.getTime(), diagrama, diagramaInicioMs)
  const isFeriado = esFeriadoNacional(fecha.getTime())

  if (!reg) {
    if (isFeriado) return { bg: 'bg-amber-900/40 border-amber-700/40', label: 'Feriado', labelColor: 'text-amber-400' }
    if (isFrancoByDiag) return { bg: 'bg-slate-700/30 border-slate-600/20', label: 'Franco', labelColor: 'text-slate-500' }
    return { bg: 'bg-slate-900/0 border-slate-700/30', label: '', labelColor: '' }
  }

  if (reg.esAusenciaJustificada) return { bg: 'bg-red-900/40 border-red-700/40', label: 'Ausencia', labelColor: 'text-red-400' }
  if (reg.esFeriado && esDiaNoTrabajado(reg)) return { bg: 'bg-amber-900/40 border-amber-700/40', label: 'Feriado', labelColor: 'text-amber-400' }
  if (reg.esFrancoCompensatorio) return { bg: 'bg-purple-900/40 border-purple-700/40', label: 'F.Comp', labelColor: 'text-purple-400' }
  if (reg.esFrancoTrabajado) return { bg: 'bg-cyan-900/40 border-cyan-700/40', label: 'F.Trab', labelColor: 'text-cyan-400' }
  if (reg.esFeriadoTrabajado) return { bg: 'bg-orange-900/40 border-orange-700/40', label: 'F.Trab', labelColor: 'text-orange-400' }
  if (esDiaNoTrabajado(reg)) return { bg: 'bg-slate-700/30 border-slate-600/20', label: 'Franco', labelColor: 'text-slate-500' }
  if (reg.lugarTrabajo === 'Campo') return { bg: 'bg-emerald-900/40 border-emerald-700/40', label: 'Campo', labelColor: 'text-emerald-400' }
  if (reg.lugarTrabajo === 'Base') return { bg: 'bg-blue-900/40 border-blue-700/40', label: 'Base', labelColor: 'text-blue-400' }
  return { bg: 'bg-slate-700/20 border-slate-600/30', label: '', labelColor: '' }
}

export function CalendarGrid({ dias, byDay, diagrama, diagramaInicioMs, onSelectDate, onContext }: Props) {
  if (dias.length === 0) return null

  // Single ref for long-press tracking (only one touch at a time)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpFired = useRef(false)
  const lpMoved = useRef(false)
  const lpStart = useRef<{ x: number; y: number } | null>(null)
  const LP_MOVE_TOLERANCE = 10 // px — ignore finger jitter so the long-press still fires

  // Pad start so row begins on Monday
  const startPad = dowMon(dias[0])
  const cells: (Date | null)[] = [...Array(startPad).fill(null), ...dias]
  // Pad end to complete last row
  const endPad = (7 - (cells.length % 7)) % 7
  for (let i = 0; i < endPad; i++) cells.push(null)

  const rows: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))

  return (
    <div className="px-2 pb-2">
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DIAS_HEADER.map(d => (
          <div key={d} className="text-center text-xs text-slate-500 font-medium py-1">{d}</div>
        ))}
      </div>

      {/* Weeks */}
      <div className="space-y-1">
        {rows.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((date, di) => {
              if (!date) return <div key={di} className="aspect-square" />
              const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
              const reg = byDay.get(key)
              const { bg, label, labelColor } = cellStyle(date, reg, diagrama, diagramaInicioMs)
              const isFeriado = esFeriadoNacional(date.getTime())
              const h = reg && !esDiaNoTrabajado(reg) ? calcularHorasDia(reg) : null
              const isFirstOfMonth = date.getDate() === 1

              return (
                <button
                  key={di}
                  onClick={() => { if (lpFired.current) { lpFired.current = false; return } onSelectDate(date) }}
                  onTouchStart={e => {
                    lpFired.current = false; lpMoved.current = false
                    const touch = e.touches[0]
                    lpStart.current = { x: touch.clientX, y: touch.clientY }
                    lpTimer.current = setTimeout(() => {
                      if (!lpMoved.current) { lpFired.current = true; onContext?.(date, touch.clientX, touch.clientY) }
                    }, 500)
                  }}
                  onTouchMove={e => {
                    const t = e.touches[0]; const s = lpStart.current
                    if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > LP_MOVE_TOLERANCE) {
                      lpMoved.current = true
                      if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null }
                    }
                  }}
                  onTouchEnd={() => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }}
                  onContextMenu={e => { e.preventDefault(); onContext?.(date, e.clientX, e.clientY) }}
                  className={`aspect-square rounded-lg border flex flex-col items-center justify-center p-0.5 active:scale-95 transition-transform ${bg}`}
                >
                  {isFirstOfMonth && (
                    <span className="text-[8px] leading-none text-slate-500 uppercase tracking-wide">
                      {MESES_SHORT[date.getMonth()]}
                    </span>
                  )}
                  <span className={`text-sm font-bold leading-tight ${isFeriado && !reg ? 'text-amber-400' : reg ? 'text-white' : 'text-slate-400'}`}>
                    {fmt2(date.getDate())}
                  </span>
                  {label && (
                    <span className={`text-[8px] leading-none font-medium ${labelColor} truncate w-full text-center`}>
                      {label}
                    </span>
                  )}
                  {h && h.horasTrabajadas > 0 && (
                    <span className="text-[7px] leading-none text-slate-400">
                      {h.horasTrabajadas}h
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
