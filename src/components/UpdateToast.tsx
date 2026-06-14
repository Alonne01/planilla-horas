import { useEffect, useRef } from 'react'
import updateChar from '../assets/update-char.png'

/**
 * Toast chico y no intrusivo: avisa que hay una actualización disponible. El personaje hace su
 * animación (pulgar arriba) UNA sola vez y queda en el último frame (sin bucle). Aparece ~3 s y
 * luego App recarga para aplicar la nueva versión.
 *
 * Los frames se detectan del spritesheet (tira horizontal de cuadros ~cuadrados): nº de frames =
 * ancho / alto redondeado. Animación con la Web Animations API: steps(n-1), fill forwards.
 */
export function UpdateToast() {
  const spriteRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const el = spriteRef.current
      if (!el) return
      const n = Math.max(2, Math.round(img.naturalWidth / img.naturalHeight))
      el.style.backgroundSize = `${n * 100}% 100%`
      el.animate(
        { backgroundPosition: ['0% 0%', '100% 0%'] },
        { duration: 1100, easing: `steps(${n - 1})`, fill: 'forwards' },
      )
    }
    img.src = updateChar
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-3"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-2 rounded-full border border-sky-500/30 bg-slate-800/95 py-1.5 pl-1.5 pr-3.5 shadow-lg shadow-black/40 backdrop-blur animate-[gate-rise_260ms_ease_both]">
        <div
          ref={spriteRef}
          className="shrink-0"
          style={{
            width: 34,
            height: 34,
            backgroundImage: `url(${updateChar})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: '1100% 100%', // default 11 frames; se ajusta al cargar la imagen
          }}
        />
        <span className="text-xs font-medium text-slate-200">Nueva versión — actualizando…</span>
      </div>
    </div>
  )
}
