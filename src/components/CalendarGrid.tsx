import { useRef, useState } from 'react'
import type { RegistroHoras } from '../db/database'
import { esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'
import { esFeriadoNacional } from '../lib/feriados'
import { calcularHorasDia, esDiaNoTrabajado, type LineaTrabajo } from '../lib/calculo-horas'

interface Props {
  dias: Date[]
  byDay: Map<string, RegistroHoras>
  diagrama: DiagramaPatternKey
  diagramaInicioMs: number
  onSelectDate: (d: Date, rect?: DOMRect) => void
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
  /** Clave del día resaltado durante el tour (le pone data-tour="hrs-dia") */
  tourDayKey?: string | null
  /** Modo "borrar días" activo: se pintan (tocando o arrastrando) los días a borrar */
  deleteMode?: boolean
  /** Claves de los días seleccionados para borrar (resaltados en rojo) */
  selectedDeleteKeys?: Set<string> | null
  /** Pinta/despinta un día para borrar (sólo días con datos). Disparado al tocar o arrastrar. */
  onDeletePaint?: (date: Date, mode: 'add' | 'remove') => void
  /** Línea de trabajo: afecta el conteo de horas mostrado (SBDP suma 12 h al 50% en Campo). */
  lineaTrabajo?: LineaTrabajo
  /** Días recién reescritos (copiados/borrados): animan una "reescritura" escalonada SÓLO ellos. */
  rewriteKeys?: Set<string> | null
  /** Token que cambia en cada reescritura → re-dispara la animación (remonta sólo esos botones). */
  rewriteToken?: number
  /** Estado VIEJO (antes de escribir) de cada día reescrito → cara delantera del flip de dos caras. */
  rewritePrev?: Map<string, RegistroHoras | undefined> | null
  /** Escalonar el flip por día (copiar/borrar selección) o girar todos a la vez (borrar período). */
  rewriteStagger?: boolean
}

/** Visual de una celda (fondo, etiqueta, horas) según un registro — para pintar cada cara del flip. */
function dayVisual(date: Date, reg: RegistroHoras | undefined, diagrama: DiagramaPatternKey, diagramaInicioMs: number, lineaTrabajo: LineaTrabajo) {
  const { bg, label, labelColor } = cellStyle(date, reg, diagrama, diagramaInicioMs)
  const h = reg && !esDiaNoTrabajado(reg) ? calcularHorasDia(reg, lineaTrabajo) : null
  return { bg, label, labelColor, h }
}

type DayVis = ReturnType<typeof dayVisual>

/** Una cara del card-flip: caja con su fondo + número + etiqueta + mini-barra de horas. Recibe su
 *  propia animación (`anim`) y delay — la perspectiva va por-elemento dentro del keyframe, así no
 *  depende de un ancestro 3D y nunca se aplana ni se ve espejada. */
function DayFace({ date, reg, vis, anim, delayMs }: { date: Date; reg: RegistroHoras | undefined; vis: DayVis; anim: string; delayMs: number }) {
  const isFeriado = esFeriadoNacional(date.getTime())
  const isFirstOfMonth = date.getDate() === 1
  return (
    <div
      className={`absolute inset-0 rounded-lg border flex flex-col items-center justify-center p-0.5 ${anim} ${vis.bg}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span className="relative z-10 flex flex-col items-center justify-center">
        {isFirstOfMonth && (
          <span className="text-[8px] leading-none text-slate-500 uppercase tracking-wide">{MESES_SHORT[date.getMonth()]}</span>
        )}
        <span className={`text-sm font-bold leading-tight ${isFeriado && !reg ? 'text-amber-400' : reg ? 'text-white' : 'text-slate-400'}`}>{fmt2(date.getDate())}</span>
        {vis.label && (
          <span className={`text-[8px] leading-none font-medium ${vis.labelColor} truncate w-full text-center`}>{vis.label}</span>
        )}
      </span>
      {vis.h && vis.h.horasTrabajadas > 0 && (
        <span className="pointer-events-none absolute inset-x-1.5 bottom-1 z-10 flex h-[3px] gap-px">
          {vis.h.horasNormales > 0 && <span className="rounded-full bg-white/75" style={{ flex: vis.h.horasNormales }} />}
          {vis.h.horasAl50 > 0 && <span className="rounded-full bg-amber-400/85" style={{ flex: vis.h.horasAl50 }} />}
          {vis.h.horasAl100 > 0 && <span className="rounded-full bg-orange-400/85" style={{ flex: vis.h.horasAl100 }} />}
        </span>
      )}
    </div>
  )
}

const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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

  if (reg.esFaltaInjustificada) return { bg: 'bg-rose-900/40 border-rose-700/40', label: 'Falta', labelColor: 'text-rose-400' }
  if (reg.esVacaciones) return { bg: 'bg-teal-900/40 border-teal-700/40', label: 'Vacac.', labelColor: 'text-teal-400' }
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

export function CalendarGrid({ dias, byDay, diagrama, diagramaInicioMs, onSelectDate, onContext, applyMode = false, sourceKey = null, paintedKeys = null, onPaint, pulseKey = null, tourDayKey = null, deleteMode = false, selectedDeleteKeys = null, onDeletePaint, lineaTrabajo = 'SURFACE_WELL_TESTING', rewriteKeys = null, rewriteToken = 0, rewritePrev = null, rewriteStagger = true }: Props) {
  // Single ref for long-press tracking (only one touch at a time)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpFired = useRef(false)
  const lpMoved = useRef(false)
  const lpStart = useRef<{ x: number; y: number } | null>(null)
  const LP_MOVE_TOLERANCE = 10 // px — ignore finger jitter so the long-press still fires
  // Feedback de long-press: anillo que se "carga" mientras se mantiene apretado un día con datos
  // (antes de abrir "copiar"). Aparece tras un retardo corto para no parpadear en taps rápidos.
  const [pressingKey, setPressingKey] = useState<string | null>(null)
  const lpRingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cancelPress() {
    if (lpRingTimer.current) { clearTimeout(lpRingTimer.current); lpRingTimer.current = null }
    setPressingKey(prev => (prev === null ? prev : null))
  }

  // ─── Pintado por arrastre (modo aplicar): un "trazo" pinta o despinta según el primer día tocado ───
  const paintActive = useRef(false)
  const paintMode = useRef<'add' | 'remove'>('add')
  const paintHandled = useRef<Set<string>>(new Set())  // días ya tocados en este trazo (no re-togglear)
  const dateByKey = new Map(dias.map(d => [keyOf(d), d]))
  const todayKey = keyOf(new Date())  // para marcar el día de HOY en el calendario
  // Rango (orden cronológico) de los días recién reescritos → escalona la animación de "reescritura".
  const rewriteRank = (() => {
    if (!rewriteKeys || rewriteKeys.size === 0) return null
    const m = new Map<string, number>()
    let i = 0
    for (const d of dias) { const k = keyOf(d); if (rewriteKeys.has(k)) m.set(k, i++) }
    return m
  })()
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
              if (!date) return <div key={di} className="aspect-square sm:aspect-auto sm:h-[clamp(2.5rem,8vh,4.25rem)]" />
              const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
              const reg = byDay.get(key)
              const { bg, label, labelColor } = cellStyle(date, reg, diagrama, diagramaInicioMs)
              const isFeriado = esFeriadoNacional(date.getTime())
              const h = reg && !esDiaNoTrabajado(reg) ? calcularHorasDia(reg, lineaTrabajo) : null
              const isFirstOfMonth = date.getDate() === 1
              const isSource = applyMode && key === sourceKey
              const isPainted = applyMode && !!paintedKeys?.has(key)
              const isOverwrite = isPainted && !!reg          // día pintado que ya tenía datos → se sobrescribe
              const isPulsing = key === pulseKey
              const isSelectedForDelete = deleteMode && !!selectedDeleteKeys?.has(key)
              const isToday = key === todayKey
              const cellIndex = wi * 7 + di
              const rwRank = rewriteRank?.get(key)
              const isRewrite = rwRank !== undefined
              // Textura sutil (rayas diagonales) en francos/findes SIN trabajar, para leer el diagrama de un vistazo.
              const francoTexture = !h && esFrancoPorDiagrama(date.getTime(), diagrama, diagramaInicioMs)

              // Estado de pintado (copiar/borrar): color del relleno + glow. El overlay se monta SÓLO
              // cuando el día está pintado, así su animación de entrada (splash) corre una vez por pintada;
              // al arrastrar el dedo, cada día estrena su splash → se ve una "ola" de relleno.
              const paint = isSource
                ? { c: 'rgba(56,189,248,0.95)', bg: 'rgba(56,189,248,0.14)' }
                : isSelectedForDelete
                  ? { c: 'rgba(248,113,113,0.96)', bg: 'rgba(248,113,113,0.18)' }
                  : isOverwrite
                    ? { c: 'rgba(251,191,36,0.96)', bg: 'rgba(251,191,36,0.16)' }
                    : isPainted
                      ? { c: 'rgba(52,211,153,0.96)', bg: 'rgba(52,211,153,0.16)' }
                      : null

              const flipping = isRewrite && !!rewritePrev && !reduceMotion
              // Escalonado por día (copiar/borrar selección) o todos a la vez (borrar período → estado 0).
              const flipDelay = rewriteStagger ? 300 + (rwRank ?? 0) * 80 : 300
              return (
                <div
                  key={di}
                  className="relative aspect-square sm:aspect-auto sm:h-[clamp(2.5rem,8vh,4.25rem)]"
                >
                {/* Overlay del flip (puerta, eje Y) SÓLO durante la reescritura: cara VIEJA → cara NUEVA.
                    El botón de abajo queda montado pero oculto (visibility) → al terminar no se re-anima. */}
                {flipping && (
                  <div key={`rw${rewriteToken}`} className="pointer-events-none absolute inset-0 z-20">
                    <DayFace date={date} reg={rewritePrev!.get(key)} vis={dayVisual(date, rewritePrev!.get(key), diagrama, diagramaInicioMs, lineaTrabajo)} anim="animate-[day-flip-out_600ms_ease-in-out_both]" delayMs={flipDelay} />
                    <DayFace date={date} reg={reg} vis={{ bg, label, labelColor, h }} anim="animate-[day-flip-in_600ms_ease-in-out_both]" delayMs={flipDelay} />
                  </div>
                )}
                <div
                  className="h-full w-full animate-[cell-in_320ms_ease-out_both]"
                  style={{ animationDelay: `${Math.min(cellIndex * 10, 360)}ms`, visibility: flipping ? 'hidden' : 'visible' }}
                >
                <button
                  data-daykey={key}
                  data-tour={key === tourDayKey ? 'hrs-dia' : undefined}
                  onClick={e => {
                    if (paintEnabled) return  // aplicar/borrar se manejan con pointer events (pintado)
                    if (lpFired.current) { lpFired.current = false; return }
                    onSelectDate(date, e.currentTarget.getBoundingClientRect())  // rect → "crecer desde la celda"
                  }}
                  onPointerDown={() => startStroke(date)}
                  onTouchStart={e => {
                    if (applyMode || deleteMode) return
                    lpFired.current = false; lpMoved.current = false
                    const touch = e.touches[0]
                    lpStart.current = { x: touch.clientX, y: touch.clientY }
                    // El anillo aparece recién a los ~140 ms (no parpadea en taps) y sólo en días con datos.
                    if (byDay.has(key)) lpRingTimer.current = setTimeout(() => setPressingKey(key), 140)
                    lpTimer.current = setTimeout(() => {
                      if (!lpMoved.current) { lpFired.current = true; onContext?.(date, touch.clientX, touch.clientY) }
                      cancelPress()
                    }, 500)
                  }}
                  onTouchMove={e => {
                    if (applyMode || deleteMode) return
                    const t = e.touches[0]; const s = lpStart.current
                    if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > LP_MOVE_TOLERANCE) {
                      lpMoved.current = true
                      if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null }
                      cancelPress()
                    }
                  }}
                  onTouchEnd={() => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } cancelPress() }}
                  onContextMenu={e => { e.preventDefault(); if (!applyMode && !deleteMode) onContext?.(date, e.clientX, e.clientY) }}
                  className={`relative h-full w-full rounded-lg border flex flex-col items-center justify-center p-0.5 active:scale-95 transition-transform ${bg} ${francoTexture ? 'franco-stripes' : ''} ${isToday ? 'ring-1 ring-inset ring-sky-400/40' : ''} ${deleteMode && !reg ? 'opacity-30' : ''} ${isPulsing ? 'animate-[paint-bounce_460ms_ease-out]' : ''} ${paintEnabled && !isSource ? 'cursor-pointer' : ''}`}
                >
                  {/* Indicador de HOY: anillo sutil (arriba) + punto acentuado que pulsa, por encima de todo. */}
                  {isToday && (
                    <span className="pointer-events-none absolute right-1 top-1 z-20 h-1.5 w-1.5 rounded-full bg-sky-400 animate-[today-dot_2s_ease-in-out_infinite]" />
                  )}
                  {/* Anillo de long-press: se "carga" mientras se mantiene apretado (antes de "copiar"). */}
                  {pressingKey === key && (
                    <span className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
                      <svg viewBox="0 0 36 36" className="h-[78%] w-[78%] -rotate-90">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(56,189,248,0.25)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(56,189,248)" strokeWidth="3" strokeLinecap="round"
                          style={{ strokeDasharray: 100.5, strokeDashoffset: 100.5, animation: 'tour-ring 360ms linear forwards' }} />
                      </svg>
                    </span>
                  )}
                  {/* Overlay de pintado en DOS capas: relleno que "salpica" desde el centro (splash) +
                      anillo/glow con box-shadow estático que respira por opacity (fluido y barato). */}
                  {paint && (
                    <>
                      <span
                        className="pointer-events-none absolute inset-0 rounded-lg animate-[paint-splash_360ms_cubic-bezier(.34,1.56,.64,1)_both]"
                        style={{ backgroundColor: paint.bg }}
                      />
                      <span
                        className="pointer-events-none absolute inset-0 rounded-lg animate-[paint-glow_2.2s_ease-in-out_infinite]"
                        style={{ color: paint.c, boxShadow: '0 0 0 1.5px currentColor, 0 0 12px 1px currentColor' }}
                      />
                    </>
                  )}
                  <span className="relative z-10 flex flex-col items-center justify-center">
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
                  </span>
                  {/* Mini-barra de horas (normales / 50% / 100%) al pie: densidad de info de un vistazo. */}
                  {h && h.horasTrabajadas > 0 && (
                    <span className="pointer-events-none absolute inset-x-1.5 bottom-1 z-10 flex h-[3px] gap-px">
                      {h.horasNormales > 0 && <span className="rounded-full bg-white/75" style={{ flex: h.horasNormales }} />}
                      {h.horasAl50 > 0 && <span className="rounded-full bg-amber-400/85" style={{ flex: h.horasAl50 }} />}
                      {h.horasAl100 > 0 && <span className="rounded-full bg-orange-400/85" style={{ flex: h.horasAl100 }} />}
                    </span>
                  )}
                </button>
                </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
