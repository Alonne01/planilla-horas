import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { MERCADOPAGO_DONACION_URL } from '../lib/calculo-salarial'
import donadorSheet from '../assets/donador.png'

// Frases del personaje (se elige una al azar cada vez que aparece).
const DIALOGOS = [
  "si querés podés darme un vueltito",
  "si querés podés darme unos pesos",
  "si querés podés pagarme el almuerzo",
  "si querés podés invitarme un helado",
  "si querés podés darme unos mangos",
  "una monedita pa' la programación loco",
  "una monedita pal Nico",
  "bailaré por dinero",
  "necesito dólares y me conformo con centavos",
]

// Cuenta cuántas veces se montó la pantalla Horas en esta sesión de app. El
// personaje aparece en la 1ª visita (inicio) y luego cada 2 (3ª, 5ª, 7ª…), o sea
// "cada inicio y cada 2 veces que vuelvo a la pantalla". Se reinicia al recargar.
let visitasHoras = 0

const FRAME = 100 // px en pantalla de cada cuadro (sheet nativo: 3 × 512×512)
const SWIPE_UMBRAL = 50 // px para descartar deslizando

export function DonadorDonacion() {
  // Se decide en el montaje (1 vez por visita): impares muestran, pares ocultan.
  const [visible, setVisible] = useState(() => {
    visitasHoras += 1
    return visitasHoras % 2 === 1
  })
  // Frase al azar, fija mientras está en pantalla; nueva en cada aparición.
  const [dialogo] = useState(() => DIALOGOS[Math.floor(Math.random() * DIALOGOS.length)])
  const [leaving, setLeaving] = useState(false)

  // Deslizar para descartar
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const startRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (!visible) return
    const tLeave = setTimeout(() => setLeaving(true), 10_000)        // empieza la muerte
    const tGone = setTimeout(() => setVisible(false), 11_060)        // desmonta tras la animación (~1s)
    return () => { clearTimeout(tLeave); clearTimeout(tGone) }
  }, [visible])

  if (!visible) return null

  function onPointerDown(e: ReactPointerEvent<HTMLAnchorElement>) {
    if (leaving || dismissing) return
    startRef.current = { x: e.clientX, y: e.clientY, moved: false }
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLAnchorElement>) {
    const s = startRef.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) s.moved = true
    if (s.moved) setDragX(dx)
  }

  function onPointerUp(e: ReactPointerEvent<HTMLAnchorElement>) {
    const s = startRef.current
    startRef.current = null
    setDragging(false)
    if (!s || !s.moved) { setDragX(0); return }
    suppressClickRef.current = true // hubo arrastre: que el tap no abra el link
    const dx = e.clientX - s.x
    if (Math.abs(dx) > SWIPE_UMBRAL) {
      // vuela hacia el lado y se desvanece, luego desmonta
      setDismissing(true)
      setDragX(dx > 0 ? 340 : -340)
      setTimeout(() => setVisible(false), 300)
    } else {
      setDragX(0) // no alcanzó: vuelve a su lugar
    }
  }

  function onPointerCancel() {
    startRef.current = null
    setDragging(false)
    if (!dismissing) setDragX(0)
  }

  function onClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (suppressClickRef.current) {
      e.preventDefault()
      suppressClickRef.current = false
    }
  }

  const spriteBase: CSSProperties = {
    width: '100%',
    height: '100%',
    backgroundImage: `url(${donadorSheet})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '300% 100%',
    backgroundPositionX: '0%',
  }

  const dragOpacity = dismissing ? 0 : dragging ? Math.max(0.25, 1 - Math.abs(dragX) / 220) : 1

  return (
    <>
      {/* Filtro de ondas (displacement animado). Sólo en el DOM mientras muere,
          así el SMIL arranca con la muerte. */}
      {leaving && (
        <svg aria-hidden width="0" height="0" style={{ position: 'absolute' }}>
          <filter id="donador-wave" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.01 0.022" numOctaves={2} seed={7} result="noise">
              <animate attributeName="baseFrequency" dur="1.3s" values="0.01 0.022; 0.016 0.034; 0.01 0.022" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={16} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}

      <a
        href={MERCADOPAGO_DONACION_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Donación por MercadoPago"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
        style={{
          width: `${FRAME}px`,
          height: `${FRAME}px`,
          left: '0.5rem',
          bottom: 'calc(2.5rem + env(safe-area-inset-bottom))', // sentado sobre el nav
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          opacity: dragOpacity,
          transition: dragging ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease',
          touchAction: 'pan-y', // arrastre horizontal nuestro; scroll vertical pasa
        }}
        className={`fixed z-40 block origin-bottom-left ${leaving || dismissing ? 'pointer-events-none' : ''}`}
      >
        {/* Contenedor del personaje. Al morir aplica la onda (displacement SVG). */}
        <div
          className={`absolute bottom-0 left-0 ${leaving ? 'donador-ondeando' : ''}`}
          style={{ width: `${FRAME}px`, height: `${FRAME}px` }}
        >
          {/* Vivo: sube y camina. Muriendo: flash rojo → borroso + se desvanece. */}
          <div
            style={leaving ? spriteBase : { ...spriteBase, animation: 'donador-rise 360ms ease-out both, donador-walk 1s steps(3) infinite' }}
            className={leaving ? 'donador-muriendo' : ''}
          />
        </div>

        {/* Globo de diálogo, arriba a la derecha del personaje.
            w-max + max-w fuerza ancho intrínseco (evita el colapso a ~46px del
            contenedor de 100px) → frases largas en 2 líneas anchas, no 6 angostas. */}
        <div
          style={{
            animation: leaving
              ? 'donador-bubble-out 220ms ease-in forwards'
              : 'donador-bubble-in 340ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both',
          }}
          className="absolute bottom-[74px] left-[54px] w-max max-w-[200px] rounded-[20px] bg-slate-200 px-3.5 py-2 text-[11px] font-semibold leading-snug text-slate-800 shadow-[0_8px_20px_-6px_rgba(2,6,23,0.55)] ring-1 ring-slate-900/10"
        >
          {dialogo}
          {/* colita triangular que apunta al personaje */}
          <span className="absolute -bottom-[7px] left-3 h-0 w-0 border-x-[7px] border-x-transparent border-t-[9px] border-t-slate-200 drop-shadow-[0_2px_1px_rgba(2,6,23,0.22)]" />
        </div>
      </a>
    </>
  )
}
