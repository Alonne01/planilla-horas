import { useState, useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'

// ── Geometría del barril 3D ──────────────────────────────────────────────
const ITEM_H = 36                 // alto de cada fila (px)
const VISIBLE = 5                 // filas visibles (debe ser impar)
const ANGLE = 18                  // grados entre ítems contiguos sobre el cilindro
const RADIUS = ITEM_H / 2 / Math.tan((ANGLE * Math.PI) / 360) // radio del cilindro
const PERSPECTIVE = 760           // perspectiva → ítem central se agranda ~17%
const BOX_H = ITEM_H * VISIBLE    // alto total del selector

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

function haptic() {
  try { navigator.vibrate?.(6) } catch { /* no soportado */ }
}

/** Resistencia elástica al pasar los extremos. */
function rubber(s: number, n: number): number {
  if (s < 0) return s * 0.35
  if (s > n - 1) return n - 1 + (s - (n - 1)) * 0.35
  return s
}

interface DrumColumnProps {
  items: string[]
  value: string
  onChange: (v: string) => void
}

function DrumColumn({ items, value, onChange }: DrumColumnProps) {
  const N = items.length
  const targetIndex = Math.max(0, items.indexOf(value))

  const scroll = useRef(targetIndex)        // posición continua (en unidades de ítem)
  const lastHaptic = useRef(targetIndex)
  const lastEmitted = useRef(targetIndex)

  const dragging = useRef(false)
  const moved = useRef(false)
  const startY = useRef(0)
  const startScroll = useRef(0)
  const lastMoveY = useRef(0)
  const lastMoveT = useRef(0)
  const vel = useRef(0)                     // velocidad (ítems/ms)
  const raf = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [pos, setPos] = useState(targetIndex)  // posición espejada en estado para el render
  const clamp = useCallback((s: number) => Math.max(0, Math.min(N - 1, s)), [N])

  // Mueve la posición (ref = fuente de verdad, estado = render) y dispara háptica al cruzar un ítem.
  const apply = useCallback((s: number) => {
    scroll.current = s
    setPos(s)
    const ri = clamp(Math.round(s))
    if (ri !== lastHaptic.current) { lastHaptic.current = ri; haptic() }
  }, [clamp])

  const emit = useCallback(() => {
    const idx = clamp(Math.round(scroll.current))
    if (idx !== lastEmitted.current) {
      lastEmitted.current = idx
      onChange(items[idx])
    }
  }, [clamp, items, onChange])

  const stop = useCallback(() => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null }
  }, [])

  // Anima scroll → target con ease-out exponencial; emite al asentar.
  const animateTo = useCallback((target: number, tau = 110) => {
    stop()
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(40, now - prev); prev = now
      const k = 1 - Math.exp(-dt / tau)
      apply(scroll.current + (target - scroll.current) * k)
      if (Math.abs(target - scroll.current) < 0.0015) {
        apply(target)
        raf.current = null
        emit()
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [apply, emit, stop])

  // Sincroniza con cambios externos del valor (reset, etc.) cuando está inactivo.
  useEffect(() => {
    if (dragging.current || raf.current != null) return
    if (clamp(Math.round(scroll.current)) !== targetIndex) {
      lastEmitted.current = targetIndex
      animateTo(targetIndex)
    }
  }, [targetIndex, clamp, animateTo])

  useEffect(() => () => stop(), [stop])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    stop()
    dragging.current = true
    moved.current = false
    startY.current = e.clientY
    startScroll.current = scroll.current
    lastMoveY.current = e.clientY
    lastMoveT.current = performance.now()
    vel.current = 0
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const dy = e.clientY - startY.current
    if (Math.abs(dy) > 3) moved.current = true

    const now = performance.now()
    const dt = now - lastMoveT.current
    if (dt > 0) {
      const inst = -((e.clientY - lastMoveY.current) / ITEM_H) / dt
      vel.current = vel.current * 0.7 + inst * 0.3
      lastMoveY.current = e.clientY
      lastMoveT.current = now
    }
    apply(rubber(startScroll.current - dy / ITEM_H, N))
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    dragging.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }

    // Tap (sin arrastre): llevar al centro el ítem tocado.
    if (!moved.current) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const delta = Math.round((e.clientY - (rect.top + rect.height / 2)) / ITEM_H)
        animateTo(clamp(Math.round(scroll.current) + delta))
      }
      return
    }

    // Arrastre con inercia: proyectar destino según velocidad de salida.
    const projected = scroll.current + vel.current * 240
    const dist = Math.abs(projected - scroll.current)
    animateTo(clamp(Math.round(projected)), Math.max(80, Math.min(230, 80 + dist * 14)))
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    stop()
    animateTo(clamp(Math.round(scroll.current) + Math.sign(e.deltaY)))
  }

  const center = clamp(Math.round(pos))

  return (
    <div
      ref={containerRef}
      className="relative flex-1"
      style={{ height: BOX_H, perspective: PERSPECTIVE, touchAction: 'none', userSelect: 'none', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          maskImage: 'linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent)',
        }}
      >
        {items.map((item, i) => {
          const rot = -(i - pos) * ANGLE
          if (Math.abs(rot) >= 92) return null
          const isSel = center === i
          return (
            <div
              key={item}
              className="absolute inset-x-0 flex items-center justify-center"
              style={{
                height: ITEM_H,
                top: '50%',
                marginTop: -ITEM_H / 2,
                transform: `rotateX(${rot}deg) translateZ(${RADIUS}px)`,
                backfaceVisibility: 'hidden',
                opacity: Math.cos((rot * Math.PI) / 180),
              }}
            >
              <span
                className="font-mono tabular-nums transition-colors duration-150"
                style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.02em', color: isSel ? '#fff' : '#5b6675' }}
              >
                {item}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface TimeDrumPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
}

export function TimeDrumPicker({ label, value, onChange }: TimeDrumPickerProps) {
  const hasValue = value !== ''
  const parts = hasValue ? value.split(':') : ['08', '00']
  const hStr = parts[0] ?? '08'
  const mStr = (MINUTES.includes(parts[1] ?? '') ? parts[1] : '00') as string

  return (
    <div className="flex-1 min-w-0">
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      <div className="relative rounded-2xl bg-slate-900/70 ring-1 ring-white/[0.06] overflow-hidden">
        {hasValue && (
          <button
            type="button"
            onPointerDown={e => { e.stopPropagation(); onChange('') }}
            className="absolute top-1.5 right-1.5 z-20 grid place-items-center w-6 h-6 rounded-full text-slate-500 active:text-white active:bg-white/10"
            aria-label="Borrar hora"
          >
            <X size={13} />
          </button>
        )}

        {!hasValue ? (
          <button
            type="button"
            onPointerDown={() => onChange('08:00')}
            className="flex w-full items-center justify-center font-mono text-slate-600"
            style={{ height: BOX_H, fontSize: 22, letterSpacing: '0.18em' }}
          >
            – – : – –
          </button>
        ) : (
          <>
            {/* Lente central: resalta la fila seleccionada abarcando HH : MM */}
            <div
              className="absolute inset-x-2 z-0 rounded-lg border-y border-white/10 bg-white/[0.05] pointer-events-none"
              style={{ top: (BOX_H - ITEM_H) / 2, height: ITEM_H }}
            />
            <div className="relative z-10 flex items-center justify-center" style={{ height: BOX_H }}>
              <DrumColumn items={HOURS} value={hStr} onChange={h => onChange(`${h}:${mStr}`)} />
              <span
                className="select-none font-mono font-bold text-slate-300"
                style={{ fontSize: 24, marginTop: -2 }}
              >
                :
              </span>
              <DrumColumn items={MINUTES} value={mStr} onChange={m => onChange(`${hStr}:${m}`)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
