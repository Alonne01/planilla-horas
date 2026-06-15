import { useEffect, useRef, useState } from 'react'
import caracol from '../assets/caracol.png'

// Spritesheet del caracol: 2 cuadros horizontales (300x139 → 150x139 c/u). Se anima a 2 fps.
const FRAMES = 2

/**
 * Easter egg: un caracolito que asoma DESDE ATRÁS del panel de navegación y se apoya justo en su
 * borde superior, sólo cuando estás en Configuración y scrolleaste hasta el fondo. Va a `z` por
 * debajo del nav (que es opaco) para que su parte de abajo quede tapada → parece salir de atrás.
 */
export function Caracol({ navH, onSecret }: { navH: number; onSecret?: () => void }) {
  const [visible, setVisible] = useState(false)

  // Easter egg secreto: 15 toques SEGUIDOS sobre el caracol (sin ningún feedback) disparan onSecret.
  // El contador se reinicia si pasan más de 2 s entre toques.
  const taps = useRef(0)
  const tapReset = useRef<number | undefined>(undefined)
  function onTap() {
    if (tapReset.current) clearTimeout(tapReset.current)
    taps.current += 1
    if (taps.current >= 15) {
      taps.current = 0
      onSecret?.()
      return
    }
    tapReset.current = window.setTimeout(() => { taps.current = 0 }, 2000)
  }

  useEffect(() => {
    const check = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      // Sólo si la página REALMENTE se puede scrollear (no por una medición previa al layout, que
      // daba un falso "fondo" al volver a Config) y estás pegado al final.
      setVisible(scrollable > 40 && window.scrollY >= scrollable - 6)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    // Recalcular cuando cambia el alto del contenido (al terminar de cargar Config, abrir un panel,
    // etc.) para no quedar "pegado" en visible por una medición vieja.
    const ro = new ResizeObserver(check)
    ro.observe(document.body)
    return () => {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      ro.disconnect()
    }
  }, [])

  return (
    // Mismo encuadre que el nav (centrado, max-w-lg) para alinear a la derecha; z-20 < nav (z-30).
    <div aria-hidden className="pointer-events-none fixed bottom-0 left-1/2 z-20 w-full max-w-lg -translate-x-1/2" style={{ height: 0 }}>
      <div
        onPointerDown={onTap}
        className="pointer-events-auto absolute"
        style={{
          right: 12,
          bottom: navH - 1,                       // base apoyada justo en el borde superior del nav
          width: 46,
          height: 43,                             // ratio del cuadro (150/139 ≈ 1.08)
          backgroundImage: `url(${caracol})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${FRAMES * 100}% 100%`,
          // Asoma desde atrás del nav (oculto = empujado 130% hacia abajo, tapado por el nav opaco).
          transform: visible ? 'translateY(0)' : 'translateY(130%)',
          opacity: visible ? 1 : 0,
          transition: 'transform 600ms cubic-bezier(0.22,1,0.36,1), opacity 350ms ease',
          animation: 'caracol-idle 0.333s steps(2) infinite', // 2 cuadros / 0,333 s ≈ 6 fps
        }}
      />
    </div>
  )
}
