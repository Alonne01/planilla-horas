import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Heart } from 'lucide-react'
import { MERCADOPAGO_DONACION_URL } from '../lib/calculo-salarial'
import { registrarTapDonacion, registrarGracias } from '../lib/metricas'

// Tacita de café para donar: botón chico y FIJO abajo a la izquierda, al lado del botón del QR.
// Siempre está (no aparece/desaparece como el viejo personaje): humea y cada tanto se balancea
// un poquito para invitar a tocarla. Al tocarla "toma un sorbo" (se inclina + corazoncito) y abre MercadoPago. Al volver de donar (`gracias`)
// suben corazones con un "¡Gracias!" y, durante las 24 h siguientes (`calma`), queda quieta.

export function Cafecito({ hidden = false, calma = false, gracias = false, onGraciasDone }: {
  hidden?: boolean
  calma?: boolean
  gracias?: boolean
  onGraciasDone?: () => void
}) {
  // Sorbo al tocar: la taza se inclina y sube un corazoncito; MercadoPago se abre al terminar
  // (si se abriera en el acto, en el teléfono la app queda atrás y la animación no se ve).
  // `sorbo` es un contador para que cada toque remonte la animación aunque se toque seguido.
  const [sorbo, setSorbo] = useState(0)
  const [sorbiendo, setSorbiendo] = useState(false)
  const abriendoRef = useRef(false)

  function onClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (abriendoRef.current) return
    abriendoRef.current = true
    setSorbo(n => n + 1)
    setSorbiendo(true)
    // Marco la hora para detectar "volvió de donar" (heurística >1 min) y cuento el toque.
    try { localStorage.setItem('planilla-donacion-ts', String(Date.now())) } catch { /* ignore */ }
    registrarTapDonacion()
    // 550 ms queda dentro de la ventana de "gesto del usuario" de los navegadores (no lo bloquean como popup).
    window.setTimeout(() => {
      abriendoRef.current = false
      const w = window.open(MERCADOPAGO_DONACION_URL, '_blank', 'noopener,noreferrer')
      if (!w) window.location.assign(MERCADOPAGO_DONACION_URL) // popup bloqueado: abrir acá mismo
    }, 550)
  }

  return (
    <div
      className={`fixed bottom-20 left-[4.5rem] z-40 transition-all duration-200 ${
        hidden ? 'opacity-0 scale-50 pointer-events-none' : 'opacity-100'
      }`}
    >
      <a
        href={MERCADOPAGO_DONACION_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        aria-label="Invitame un cafecito (donación por MercadoPago)"
        title="Invitame un cafecito"
        className="relative w-12 h-12 rounded-full bg-slate-800/90 border border-amber-700/50 shadow-lg flex items-center justify-center backdrop-blur active:scale-95 transition-transform animate-[qr-btn-in_240ms_ease_backwards]"
      >
        <span
          key={sorbo}
          className={`cafecito-taza ${sorbiendo ? 'cafecito-sorbo' : calma ? '' : 'cafecito-balanceo'}`}
          onAnimationEnd={e => { if (e.animationName === 'cafecito-sorbo') setSorbiendo(false) }}
        >
          <TazaSvg />
        </span>
        {sorbo > 0 && (
          <span key={`c${sorbo}`} aria-hidden className="cafecito-corazon-sorbo pointer-events-none absolute left-1/2 top-1 text-pink-400">
            <Heart size={14} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </a>

      {/* Agradecimiento: corazones que suben desde la taza + globito (se monta sólo mientras dura). */}
      {gracias && <GraciasCafe onDone={onGraciasDone} />}
    </div>
  )
}

function GraciasCafe({ onDone }: { onDone?: () => void }) {
  const [graciasSaliendo, setGraciasSaliendo] = useState(false)
  // Cuenta esta aparición del "¡Gracias!" una sola vez y se retira sola a los 5 s.
  useEffect(() => {
    registrarGracias()
    const t1 = setTimeout(() => setGraciasSaliendo(true), 5_000)
    const t2 = setTimeout(() => onDone?.(), 5_450)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${graciasSaliendo ? 'animate-[cafecito-globo-out_420ms_ease-in_forwards]' : ''}`}
    >
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i}
          className="absolute"
          style={{
            left: `${4 + i * 9}px`,
            bottom: `${30 + (i % 3) * 6}px`,
            color: i % 2 ? '#fb7185' : '#f472b6',
            animation: `cafecito-corazon ${1.5 + (i % 3) * 0.3}s ease-out ${i * 0.2}s infinite`,
          }}
        >
          <Heart size={9 + (i % 3) * 3} fill="currentColor" strokeWidth={0} />
        </span>
      ))}
      <div
        style={{ animation: 'cafecito-globo-in 340ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both' }}
        className="absolute bottom-[58px] left-1 w-max rounded-2xl bg-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-800 shadow-[0_8px_20px_-6px_rgba(2,6,23,0.55)] ring-1 ring-slate-900/10"
      >
        ¡Gracias por el café!
        <span className="absolute -bottom-[6px] left-4 h-0 w-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-slate-200" />
      </div>
    </div>
  )
}

/** Taza con platito y tres hilos de vapor que suben (24×24, colores fijos: se ve igual en cualquier tema). */
function TazaSvg() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* vapor */}
      <g stroke="#e2e8f0" strokeWidth="1.3" strokeLinecap="round" opacity="0.85">
        <path className="cafecito-vapor" style={{ animationDelay: '0s' }} d="M8 8.5c-.8-1 .8-1.8 0-3" />
        <path className="cafecito-vapor" style={{ animationDelay: '0.6s' }} d="M11 8.5c-.8-1 .8-1.8 0-3" />
        <path className="cafecito-vapor" style={{ animationDelay: '1.2s' }} d="M14 8.5c-.8-1 .8-1.8 0-3" />
      </g>
      {/* asa */}
      <path d="M16.6 12.2h1.2a2.1 2.1 0 0 1 0 4.2h-1.6" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" />
      {/* cuerpo */}
      <path d="M5.2 10.5h11.6v3.8a4.3 4.3 0 0 1-4.3 4.3h-3a4.3 4.3 0 0 1-4.3-4.3z" fill="#f59e0b" />
      {/* café */}
      <ellipse cx="11" cy="10.6" rx="5.6" ry="0.9" fill="#78350f" />
      {/* brillo */}
      <path d="M7.4 12.6v1.6" stroke="#fde68a" strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />
      {/* platito */}
      <path d="M3.5 20.2h15" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
