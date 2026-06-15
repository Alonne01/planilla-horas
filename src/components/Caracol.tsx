import { useEffect, useState } from 'react'
import caracol from '../assets/caracol.png'

// Spritesheet del caracol: 2 cuadros horizontales (300x139 → 150x139 c/u). Se anima a 2 fps.
const FRAMES = 2

/**
 * Easter egg: un caracolito que asoma DESDE ATRÁS del panel de navegación y se apoya justo en su
 * borde superior, sólo cuando estás en Configuración y scrolleaste hasta el fondo. Va a `z` por
 * debajo del nav (que es opaco) para que su parte de abajo quede tapada → parece salir de atrás.
 */
export function Caracol({ navH }: { navH: number }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 6
      setVisible(atBottom)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    // Mismo encuadre que el nav (centrado, max-w-lg) para alinear a la derecha; z-20 < nav (z-30).
    <div aria-hidden className="pointer-events-none fixed bottom-0 left-1/2 z-20 w-full max-w-lg -translate-x-1/2" style={{ height: 0 }}>
      <div
        className="absolute"
        style={{
          right: 12,
          bottom: navH - 1,                       // base apoyada justo en el borde superior del nav
          width: 38,
          height: 35,                             // ratio del cuadro (150/139 ≈ 1.08)
          backgroundImage: `url(${caracol})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${FRAMES * 100}% 100%`,
          // Asoma desde atrás del nav (oculto = empujado 130% hacia abajo, tapado por el nav opaco).
          transform: visible ? 'translateY(0)' : 'translateY(130%)',
          opacity: visible ? 1 : 0,
          transition: 'transform 600ms cubic-bezier(0.22,1,0.36,1), opacity 350ms ease',
          animation: 'caracol-idle 1s steps(2) infinite', // 2 cuadros / 1 s = 2 fps
        }}
      />
    </div>
  )
}
