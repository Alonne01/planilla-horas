import { useEffect, useRef } from 'react'
import updateChar from '../assets/update-char.png'

// El spritesheet "chibi OK-sheet" es una tira horizontal de 15 cuadros (1085×1450 c/u → 16275×1450,
// proporción ~3:4 portrait). Si se cambia el sprite, actualizar FRAMES.
const FRAMES = 15

/**
 * Toast chico y no intrusivo: avisa que hay una actualización. El personaje hace su animación
 * (pulgar arriba) UNA sola vez y queda en el último frame (sin bucle). Aparece ~3 s y luego App
 * recarga para aplicar la nueva versión. Posición por porcentaje (exacta sin importar el escalado).
 */
export function UpdateToast() {
  const spriteRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    spriteRef.current?.animate(
      { backgroundPosition: ['0% 0%', '100% 0%'] },
      { duration: 1500, easing: `steps(${FRAMES - 1})`, fill: 'forwards' },
    )
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-3"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-2.5 rounded-2xl border border-sky-500/30 bg-slate-800/95 py-2 pl-2.5 pr-4 shadow-lg shadow-black/40 backdrop-blur animate-[gate-rise_260ms_ease_both]">
        <div
          ref={spriteRef}
          className="shrink-0"
          style={{
            width: 42,             // proporción del cuadro (1085×1450 ≈ 3:4)
            height: 56,
            backgroundImage: `url(${updateChar})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${FRAMES * 100}% 100%`,
          }}
        />
        <span className="text-sm font-medium text-slate-200">Nueva versión — actualizando…</span>
      </div>
    </div>
  )
}
