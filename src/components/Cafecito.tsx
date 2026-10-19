import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Heart } from 'lucide-react'
import { MERCADOPAGO_DONACION_URL } from '../lib/calculo-salarial'
import { registrarTapDonacion, registrarGracias } from '../lib/metricas'

// Tacita de café para donar: botón chico y FIJO abajo a la izquierda, al lado del botón del QR.
// Siempre está (no aparece/desaparece como el viejo personaje): humea y cada tanto se balancea
// un poquito para invitar a tocarla, y una vez por sesión asoma un cartelito "click acá".
// Al tocarla: onda + vibración corta (Android), la taza "toma un sorbo" (se inclina, baja el café,
// sube un corazoncito), avisa "Abriendo MercadoPago…" y lo abre. Al volver de donar (`gracias`)
// suben corazones con un "¡Gracias!" y, durante las 24 h siguientes (`calma`), queda quieta con
// una insignia de corazón.

// El cartel "click acá" sale una sola vez por sesión de la app (se reinicia al recargar/reabrir).
let cartelMostrado = false

export function Cafecito({ hidden = false, calma = false, gracias = false, onGraciasDone }: {
  hidden?: boolean
  calma?: boolean
  gracias?: boolean
  onGraciasDone?: () => void
}) {
  // Sorbo al tocar: MercadoPago se abre al terminar la animación (si se abriera en el acto, en el
  // teléfono la app queda atrás y no se ve). `sorbo` es un contador para que cada toque remonte
  // las animaciones aunque se toque seguido.
  const [sorbo, setSorbo] = useState(0)
  const [sorbiendo, setSorbiendo] = useState(false)
  const [abriendo, setAbriendo] = useState(false)
  const abriendoRef = useRef(false)
  const [cartel, setCartel] = useState<null | 'in' | 'out'>(null)

  // Cartel "click acá": asoma a los 1,5 s, se queda 3,5 s y se esconde. No sale si ya donó hoy.
  useEffect(() => {
    if (cartelMostrado || calma || hidden) return
    const t1 = setTimeout(() => { cartelMostrado = true; setCartel('in') }, 1_500)
    const t2 = setTimeout(() => setCartel(c => (c ? 'out' : c)), 5_000)
    const t3 = setTimeout(() => setCartel(null), 5_300)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [calma, hidden])

  function onClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (abriendoRef.current) return
    abriendoRef.current = true
    setCartel(null)
    setSorbo(n => n + 1)
    setSorbiendo(true)
    setAbriendo(true)
    try { navigator.vibrate?.(12) } catch { /* sin vibración (iPhone/escritorio) */ }
    // Marco la hora para detectar "volvió de donar" (heurística >1 min) y cuento el toque.
    try { localStorage.setItem('planilla-donacion-ts', String(Date.now())) } catch { /* ignore */ }
    registrarTapDonacion()
    // 550 ms queda dentro de la ventana de "gesto del usuario" de los navegadores (no lo bloquean como popup).
    window.setTimeout(() => {
      abriendoRef.current = false
      const w = window.open(MERCADOPAGO_DONACION_URL, '_blank', 'noopener,noreferrer')
      if (!w) window.location.assign(MERCADOPAGO_DONACION_URL) // popup bloqueado: abrir acá mismo
    }, 550)
    window.setTimeout(() => setAbriendo(false), 1_800)
  }

  return (
    <div
      className={`fixed bottom-[calc(var(--nav-h,3.5rem)+1.5rem)] left-[4.5rem] z-40 transition-all duration-200 ${
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
        className="relative w-12 h-12 rounded-full bg-gradient-to-b from-amber-950/95 to-slate-900/95 border border-amber-400/40 shadow-[0_0_16px_-3px_rgba(251,191,36,0.45)] flex items-center justify-center backdrop-blur active:scale-90 transition-transform animate-[qr-btn-in_240ms_ease_backwards]"
      >
        <span
          key={sorbo}
          className={`cafecito-taza ${sorbiendo ? 'cafecito-sorbo' : calma ? '' : 'cafecito-balanceo'}`}
          onAnimationEnd={e => { if (e.animationName === 'cafecito-sorbo') setSorbiendo(false) }}
        >
          <TazaSvg />
        </span>

        {/* Toque: onda cálida que se expande + corazoncito que sale de la taza. */}
        {sorbo > 0 && (
          <>
            <span key={`o${sorbo}`} aria-hidden className="cafecito-onda pointer-events-none absolute inset-0 rounded-full border-2 border-amber-300" />
            <span key={`c${sorbo}`} aria-hidden className="cafecito-corazon-sorbo pointer-events-none absolute left-1/2 top-1 text-pink-400">
              <Heart size={14} fill="currentColor" strokeWidth={0} />
            </span>
          </>
        )}

        {/* Ya donó hoy: insignia de corazón en la esquina. */}
        {calma && (
          <span aria-hidden className="absolute -top-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-pink-500 ring-2 ring-slate-900 animate-[qr-btn-in_300ms_cubic-bezier(0.34,1.56,0.64,1)_both]">
            <Heart size={10} fill="white" strokeWidth={0} />
          </span>
        )}

        {/* Cartel "click acá" (una vez por sesión), a la derecha de la taza. Es parte del link. */}
        {cartel && (
          <span
            className={`absolute left-full top-1/2 ml-2.5 w-max rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-900 shadow-[0_6px_16px_-6px_rgba(251,191,36,0.7)] ${
              cartel === 'out' ? 'animate-[cafecito-cartel-out_300ms_ease-in_forwards]' : 'animate-[cafecito-cartel-in_380ms_cubic-bezier(0.34,1.56,0.64,1)_both]'
            }`}
          >
            click acá
            <span aria-hidden className="absolute right-full top-1/2 -translate-y-1/2 h-0 w-0 border-y-[5px] border-y-transparent border-r-[6px] border-r-amber-400" />
          </span>
        )}
      </a>

      {/* Aviso mientras se abre MercadoPago. */}
      {abriendo && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-full left-0 mb-2.5 w-max rounded-full bg-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-800 shadow-[0_8px_20px_-6px_rgba(2,6,23,0.55)] animate-[cafecito-globo-in_260ms_cubic-bezier(0.34,1.56,0.64,1)_both]"
        >
          Abriendo MercadoPago…
        </div>
      )}

      {/* Agradecimiento: corazones que suben desde la taza + globito (se monta sólo mientras dura). */}
      {gracias && !abriendo && <GraciasCafe onDone={onGraciasDone} />}
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

/** Taza de cerámica con platito, café con un corazón de latte art y tres hilos de vapor. Colores fijos
 *  (se ve igual en cualquier tema). El café (`.cafecito-cafe`) baja un poco durante el sorbo. */
function TazaSvg() {
  const id = useId().replace(/:/g, '')
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffedd5" />
          <stop offset="0.55" stopColor="#fff7ed" />
          <stop offset="1" stopColor="#fdba74" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      {/* vapor */}
      <g stroke="#f8fafc" strokeWidth="1.3" strokeLinecap="round" opacity="0.8">
        <path className="cafecito-vapor" style={{ animationDelay: '0s' }} d="M11.5 10c-1-1.2 1-2.2 0-3.6" />
        <path className="cafecito-vapor" style={{ animationDelay: '0.6s' }} d="M15 9.5c-1-1.2 1-2.2 0-3.6" />
        <path className="cafecito-vapor" style={{ animationDelay: '1.2s' }} d="M18.5 10c-1-1.2 1-2.2 0-3.6" />
      </g>
      {/* platito */}
      <ellipse cx="15.5" cy="26.4" rx="11.5" ry="2.4" fill={`url(#${id}p)`} />
      <ellipse cx="15.5" cy="25.9" rx="7" ry="1.1" fill="#64748b" opacity="0.35" />
      {/* asa */}
      <path d="M22.6 15.2h1.3a3.1 3.1 0 0 1 0 6.2h-2.2" stroke="#fed7aa" strokeWidth="2.2" strokeLinecap="round" />
      {/* cuerpo */}
      <path d="M7 13.2h16.6v4.6a7.2 7.2 0 0 1-7.2 7.2h-2.2A7.2 7.2 0 0 1 7 17.8z" fill={`url(#${id}c)`} />
      {/* café + corazón de latte art (aplastado por la perspectiva) */}
      <g className="cafecito-cafe">
        <ellipse cx="15.3" cy="13.3" rx="8.1" ry="1.9" fill="#7c2d12" />
        <path d="M15.3 14.3c-1.9-.9-2.6-1.5-2.6-2 0-.5.5-.8 1-.8.6 0 1.1.3 1.6.8.5-.5 1-.8 1.6-.8.5 0 1 .3 1 .8 0 .5-.7 1.1-2.6 2z" fill="#fde68a" opacity="0.9" transform="translate(0 7.2) scale(1 0.45)" />
      </g>
      {/* borde y brillo de la cerámica */}
      <ellipse cx="15.3" cy="13.2" rx="8.3" ry="2" stroke="#fff7ed" strokeWidth="0.9" />
      <path d="M9.6 16.4v2.4" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}
