import { useEffect, useRef } from 'react'
import updateChar from '../assets/update-char.png'

// El spritesheet "chibi OK-sheet" es una tira horizontal de 15 cuadros (1085×1450 c/u, ~3:4 portrait).
const FRAMES = 15

/**
 * Toast no intrusivo que avisa que hay una actualización. El personaje hace su animación (pulgar
 * arriba) UNA vez y queda en el último frame. Aparece ~4 s (con barra de progreso) y App recarga.
 */
export function UpdateToast() {
  const spriteRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    spriteRef.current?.animate(
      { backgroundPosition: ['0% 0%', '100% 0%'] },
      { duration: 1500, easing: `steps(${FRAMES - 1})`, fill: 'forwards' },
    )
    barRef.current?.animate(
      { width: ['0%', '100%'] },
      { duration: 4000, easing: 'linear', fill: 'forwards' },
    )
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-3"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-sky-400/40 bg-gradient-to-b from-slate-800 to-slate-900 py-2.5 pl-3 pr-5 shadow-xl shadow-sky-950/50 ring-1 ring-inset ring-white/5 backdrop-blur animate-[gate-rise_280ms_ease_both]">
        <div
          ref={spriteRef}
          className="shrink-0"
          style={{
            width: 54,
            height: 72,
            backgroundImage: `url(${updateChar})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${FRAMES * 100}% 100%`,
          }}
        />
        <div className="leading-tight">
          <p className="text-sm font-bold text-white">¡Nueva versión!</p>
          <p className="text-xs text-sky-300/90">Actualizando…</p>
        </div>
        {/* barra de progreso hasta la recarga (~4 s) */}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
          <div ref={barRef} className="h-full bg-sky-400/80" style={{ width: '0%' }} />
        </div>
      </div>
    </div>
  )
}
