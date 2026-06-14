import { useEffect, useState, type CSSProperties } from 'react'
import { Coffee } from 'lucide-react'
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

export function DonadorDonacion() {
  // Se decide en el montaje (1 vez por visita): impares muestran, pares ocultan.
  const [visible, setVisible] = useState(() => {
    visitasHoras += 1
    return visitasHoras % 2 === 1
  })
  // Frase al azar, fija mientras está en pantalla; nueva en cada aparición.
  const [dialogo] = useState(() => DIALOGOS[Math.floor(Math.random() * DIALOGOS.length)])
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    const tLeave = setTimeout(() => setLeaving(true), 10_000)
    const tGone = setTimeout(() => setVisible(false), 10_400)
    return () => { clearTimeout(tLeave); clearTimeout(tGone) }
  }, [visible])

  if (!visible) return null

  const spriteStyle: CSSProperties = {
    width: `${FRAME}px`,
    height: `${FRAME}px`,
    backgroundImage: `url(${donadorSheet})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '300% 100%',
    backgroundPositionX: '0%',
    animation: 'donador-walk 1s steps(3) infinite',
  }

  return (
    <a
      href={MERCADOPAGO_DONACION_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Donación por MercadoPago"
      style={{
        width: `${FRAME}px`,
        height: `${FRAME}px`,
        left: '0.5rem',
        bottom: 'calc(2.5rem + env(safe-area-inset-bottom))', // sentado sobre el nav
      }}
      className={`fixed z-40 block origin-bottom-left transition-transform active:scale-95 ${
        leaving
          ? 'pointer-events-none animate-[donador-out_360ms_ease_both]'
          : 'animate-[donador-in_280ms_ease_both]'
      }`}
    >
      {/* Personaje, apoyado sobre la barra de navegación */}
      <div style={spriteStyle} className="absolute bottom-0 left-0" />

      {/* Globo de diálogo, arriba a la derecha del personaje.
          w-max + max-w fuerza ancho intrínseco (evita el colapso a ~46px del
          contenedor de 100px) → frases largas en 2 líneas anchas, no 6 angostas. */}
      <div className="absolute bottom-[74px] left-[54px] w-max max-w-[200px] rounded-2xl bg-white px-3 py-1.5 shadow-lg ring-1 ring-black/10">
        <span className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-slate-800">
          <Coffee size={13} className="mt-px shrink-0 text-sky-600" /> {dialogo}
        </span>
        {/* colita que apunta al personaje (abajo-izquierda) */}
        <span className="absolute -bottom-1 left-3 h-3 w-3 rotate-45 rounded-[2px] bg-white" />
      </div>
    </a>
  )
}
