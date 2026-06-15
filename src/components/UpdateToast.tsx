import { useEffect, useRef } from 'react'
import updateChar from '../assets/update-char.png'

// El spritesheet "chibi OK-sheet": tira horizontal de 15 cuadros (~3:4 portrait).
const FRAMES = 15
const PIXEL_FONT = "'Press Start 2P', monospace"

/**
 * Toast PIXEL-ART que avisa que hay una actualización. El personaje hace su animación (pulgar arriba)
 * DOS veces y queda en el último frame. Aparece ~4 s (con barra de progreso) y App recarga.
 */
export function UpdateToast() {
  const spriteRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Fuente pixelart (Press Start 2P) — se inyecta sólo cuando aparece el cartel.
    if (!document.getElementById('pixel-font-pressstart')) {
      const l = document.createElement('link')
      l.id = 'pixel-font-pressstart'
      l.rel = 'stylesheet'
      l.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'
      document.head.appendChild(l)
    }
    spriteRef.current?.animate(
      { backgroundPosition: ['0% 0%', '100% 0%'] },
      { duration: 1500, easing: `steps(${FRAMES - 1})`, fill: 'forwards', iterations: 2 },
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
      {/* Panel pixel: borde grueso, esquinas duras (sin redondear), sombra dura sin blur, fondo sólido */}
      <div
        className="relative flex items-center gap-3 border-2 border-sky-300/80 bg-slate-900 py-3 pl-3 pr-5 animate-[gate-rise_280ms_ease_both]"
        style={{ boxShadow: '4px 4px 0 0 rgba(0,0,0,0.6)' }}
      >
        <div
          ref={spriteRef}
          className="shrink-0"
          style={{
            width: 60,
            height: 80,
            backgroundImage: `url(${updateChar})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${FRAMES * 100}% 100%`,
          }}
        />
        <div style={{ fontFamily: PIXEL_FONT }}>
          <p className="text-white" style={{ fontSize: 9, lineHeight: 1.4 }}>NUEVA VERSION</p>
          <p className="text-sky-300" style={{ fontSize: 7, lineHeight: 1.4, marginTop: 6 }}>ACTUALIZANDO...</p>
        </div>
        {/* barra de progreso (pixel, sin redondear) hasta la recarga (~4 s) */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div ref={barRef} className="h-full bg-sky-400" style={{ width: '0%' }} />
        </div>
      </div>
    </div>
  )
}
