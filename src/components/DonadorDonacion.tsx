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
    const tLeave = setTimeout(() => setLeaving(true), 10_000)        // empieza la muerte FF
    const tGone = setTimeout(() => setVisible(false), 10_900)        // desmonta tras la animación (820ms)
    return () => { clearTimeout(tLeave); clearTimeout(tGone) }
  }, [visible])

  if (!visible) return null

  const spriteBase: CSSProperties = {
    width: `${FRAME}px`,
    height: `${FRAME}px`,
    backgroundImage: `url(${donadorSheet})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '300% 100%',
    backgroundPositionX: '0%',
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
        leaving ? 'pointer-events-none' : ''
      }`}
    >
      {/* Personaje. Vivo: sube y camina. Muriendo: disolución estilo Final Fantasy. */}
      <div
        style={leaving ? spriteBase : { ...spriteBase, animation: 'donador-rise 360ms ease-out both, donador-walk 1s steps(3) infinite' }}
        className={`absolute bottom-0 left-0 ${leaving ? 'donador-muriendo' : ''}`}
      />

      {/* Chispas que suben mientras se disuelve */}
      {leaving && (
        <span className="donador-chispas absolute bottom-0 left-0" style={{ width: `${FRAME}px`, height: `${FRAME}px` }} />
      )}

      {/* Globo de diálogo, arriba a la derecha del personaje.
          w-max + max-w fuerza ancho intrínseco (evita el colapso a ~46px del
          contenedor de 100px) → frases largas en 2 líneas anchas, no 6 angostas. */}
      <div
        style={{
          animation: leaving
            ? 'donador-bubble-out 220ms ease-in forwards'
            : 'donador-bubble-in 340ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both',
        }}
        className="absolute bottom-[74px] left-[54px] w-max max-w-[200px] rounded-[20px] bg-white px-3.5 py-2 shadow-[0_8px_20px_-6px_rgba(2,6,23,0.55)] ring-1 ring-slate-900/10"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold leading-snug text-slate-700">
          <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-sky-100 ring-1 ring-sky-200">
            <Coffee size={11} className="text-sky-600" />
          </span>
          {dialogo}
        </span>
        {/* colita triangular que apunta al personaje */}
        <span className="absolute -bottom-[7px] left-3 h-0 w-0 border-x-[7px] border-x-transparent border-t-[9px] border-t-white drop-shadow-[0_2px_1px_rgba(2,6,23,0.22)]" />
      </div>
    </a>
  )
}
