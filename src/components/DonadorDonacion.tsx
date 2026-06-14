import { useEffect, useState, type CSSProperties } from 'react'
import { Coffee } from 'lucide-react'
import { MERCADOPAGO_DONACION_URL } from '../lib/calculo-salarial'
import donadorSheet from '../assets/donador.png'

// Aparece una sola vez por sesión de app y se desvanece a los 10 s (para no
// molestar). Tocar el globo o el personaje abre el link de MercadoPago.
let yaMostradoEnSesion = false

const FRAME = 100 // px en pantalla de cada cuadro (sheet nativo: 3 × 512×512)

export function DonadorDonacion() {
  const [mounted, setMounted] = useState(() => !yaMostradoEnSesion)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!mounted) return
    yaMostradoEnSesion = true
    const tLeave = setTimeout(() => setLeaving(true), 10_000)
    const tGone = setTimeout(() => setMounted(false), 10_400)
    return () => { clearTimeout(tLeave); clearTimeout(tGone) }
  }, [mounted])

  if (!mounted) return null

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
    <div className="fixed bottom-20 left-3 z-40 select-none">
      <a
        href={MERCADOPAGO_DONACION_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Invitame un café — donación por MercadoPago"
        className={`block origin-bottom-left transition-transform active:scale-95 ${
          leaving
            ? 'pointer-events-none animate-[donador-out_360ms_ease_both]'
            : 'animate-[donador-in_280ms_ease_both]'
        }`}
      >
        {/* Globo de diálogo */}
        <div className="relative ml-2 mb-1 inline-block rounded-2xl bg-white px-3 py-1.5 shadow-lg ring-1 ring-black/10">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-slate-800">
            <Coffee size={13} className="text-sky-600" /> ¿Me invitás un café?
          </span>
          {/* colita que apunta al personaje */}
          <span className="absolute -bottom-1 left-5 h-3 w-3 rotate-45 rounded-[2px] bg-white" />
        </div>

        {/* Personaje animado */}
        <div style={spriteStyle} />
      </a>
    </div>
  )
}
