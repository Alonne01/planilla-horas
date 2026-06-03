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
  /** Modo "aplicar a otro día" activo: deshabilita long-press, se pintan los días destino */
  applyMode?: boolean
  /** Clave del día origen (resaltado mientras se aplica) */
  sourceKey?: string | null
  /** Claves de los días pintados (seleccionados para llenar) */
  paintedKeys?: Set<string> | null
  /** Pinta (mode 'add') o despinta (mode 'remove') un día. Disparado al tocar o arrastrar. */
  onPaint?: (date: Date, mode: 'add' | 'remove') => void
  /** Clave del día que debe reproducir la animación de aplicado */
  pulseKey?: string | null
  /** Modo "borrar días" activo: se pintan (tocando o arrastrando) los días a borrar */
  deleteMode?: boolean
  /** Claves de los días seleccionados para borrar (resaltados en rojo) */
  selectedDeleteKeys?: Set<string> | null
  /** Pinta/despinta un día para borrar (sólo días con datos). Disparado al tocar o arrastrar. */
  onDeletePaint?: (date: Date, mode: 'add' | 'remove') => void
}

const DIAS_HEADER = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function fmt2(n: number) { return String(n).padStart(2, '0') }

function keyOf(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }

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

export function CalendarGrid({ dias, byDay, diagrama, diagramaInicioMs, onSelectDate, onContext, applyMode = false, sourceKey = null, paintedKeys = null, onPaint, pulseKey = null, deleteMode = false, selectedDeleteKeys = null, onDeletePaint }: Props) {
  // Single ref for long-press tracking (only one touch at a time)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpFired = useRef(false)
  const lpMoved = useRef(false)
  const lpStart = useRef<{ x: number; y: number } | null>(null)
  const LP_MOVE_TOLERANCE = 10 // px — ignore finger jitter so the long-press still fires

  // ─── Pintado por arrastre (modo aplicar): un "trazo" pinta o despinta según el primer día tocado ───
  const paintActive = useRef(false)
  const paintMode = useRef<'add' | 'remove'>('add')
  const paintHandled = useRef<Set<string>>(new Set())  // días ya tocados en este trazo (no re-togglear)
  const dateByKey = new Map(dias.map(d => [keyOf(d), d]))
  // Pintado por arrastre activo tanto para "aplicar a otro día" como para "borrar días".
  const paintEnabled = applyMode || deleteMode

  function startStroke(date: Date) {
    if (!paintEnabled) return
    const k = keyOf(date)
    paintActive.current = true
    paintHandled.current = new Set([k])
    if (applyMode) {
      if (k === sourceKey) {               // empezar el trazo sobre el origen: no se pinta, pero el arrastre sigue
        paintMode.current = 'add'
        return
      }
      paintMode.current = paintedKeys?.has(k) ? 'remove' : 'add'
      onPaint?.(date, paintMode.current)
    } else {
      // borrar: sólo días con datos cargados
      if (!byDay.has(k)) { paintMode.current = 'add'; return }
      paintMode.current = selectedDeleteKeys?.has(k) ? 'remove' : 'add'
      onDeletePaint?.(date, paintMode.current)
    }
  }

  function moveStroke(clientX: number, clientY: number) {
    if (!paintEnabled || !paintActive.current) return
    const el = document.elementFromPoint(clientX, clientY)
    const cell = (el as HTMLElement | null)?.closest('[data-daykey]') as HTMLElement | null
    const k = cell?.dataset.daykey
    if (!k || paintHandled.current.has(k)) return
    const date = dateByKey.get(k)
    if (!date) return
    if (applyMode) {
      if (k === sourceKey) return
      paintHandled.current.add(k)
      onPaint?.(date, paintMode.current)
    } else {
      if (!byDay.has(k)) return            // no marcar días sin datos para borrar
      paintHandled.current.add(k)
      onDeletePaint?.(date, paintMode.current)
    }
  }

  function endStroke() { paintActive.current = false }

  if (dias.length === 0) return null

  // Pad start so row begins on Monday
  const startPad = dowMon(dias[0])
  const cells: (Date | null)[] = [...Array(startPad).fill(null), ...dias]
  // Pad end to complete last row
  const endPad = (7 - (cells.length % 7)) % 7
  for (let i = 0; i < endPad; i++) cells.push(null)

  const rows: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))

  return (
    <div
      className={`px-2 pb-2 ${paintEnabled ? 'select-none' : ''}`}
      style={paintEnabled ? { touchAction: 'none' } : undefined}
      onPointerMove={paintEnabled ? e => moveStroke(e.clientX, e.clientY) : undefined}
      onPointerUp={paintEnabled ? endStroke : undefined}
      onPointerCancel={paintEnabled ? endStroke : undefined}
      onPointerLeave={paintEnabled ? endStroke : undefined}
    >
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
              const isSource = applyMode && key === sourceKey
              const isPainted = applyMode && !!paintedKeys?.has(key)
              const isOverwrite = isPainted && !!reg          // día pintado que ya tenía datos → se sobrescribe
              const isPulsing = key === pulseKey
              const isSelectedForDelete = deleteMode && !!selectedDeleteKeys?.has(key)

              const applyRing = isSource
                ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-900'
                : isOverwrite
                  ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900'
                  : isPainted
                    ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900'
                    : ''

              return (
                <button
                  key={di}
                  data-daykey={key}
                  onClick={() => {
                    if (paintEnabled) return  // aplicar/borrar se manejan con pointer events (pintado)
                    if (lpFired.current) { lpFired.current = false; return }
                    onSelectDate(date)
                  }}
                  onPointerDown={() => startStroke(date)}
                  onTouchStart={e => {
                    if (applyMode || deleteMode) return
                    lpFired.current = false; lpMoved.current = false
                    const touch = e.touches[0]
                    lpStart.current = { x: touch.clientX, y: touch.clientY }
                    lpTimer.current = setTimeout(() => {
                      if (!lpMoved.current) { lpFired.current = true; onContext?.(date, touch.clientX, touch.clientY) }
                    }, 500)
                  }}
                  onTouchMove={e => {
                    if (applyMode || deleteMode) return
                    const t = e.touches[0]; const s = lpStart.current
                    if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > LP_MOVE_TOLERANCE) {
                      lpMoved.current = true
                      if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null }
                    }
                  }}
                  onTouchEnd={() => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }}
                  onContextMenu={e => { e.preventDefault(); if (!applyMode && !deleteMode) onContext?.(date, e.clientX, e.clientY) }}
                  className={`aspect-square rounded-lg border flex flex-col items-center justify-center p-0.5 active:scale-95 transition-transform ${bg} ${applyRing} ${isSelectedForDelete ? 'ring-2 ring-red-400 ring-offset-1 ring-offset-slate-900' : ''} ${deleteMode && !reg ? 'opacity-30' : ''} ${isPulsing ? (deleteMode ? 'animate-[delete-pulse_520ms_ease]' : 'animate-[apply-pulse_520ms_ease]') : ''} ${applyMode && !isSource ? 'cursor-pointer' : ''}`}
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
