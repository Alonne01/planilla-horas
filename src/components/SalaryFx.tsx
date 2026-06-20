// Efectos del "festejo" del neto en Proyección Salarial (toggle): tragaperras + lluvia de billetes.
// Versión LIVIANA del easter egg de EquipTrack (sin video): la animación es CSS pura (transform/keyframes).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fmtPesos } from '../lib/calculo-salarial'

function reduceMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Banda 0..4 según el ratio neto/básico (= memeLevelFor de EquipTrack). */
export function nivelNeto(neto: number, basico: number): number {
  if (basico <= 0) return 0
  const r = neto / basico
  return r < 2.5 ? 0 : r < 3.0 ? 1 : r < 3.5 ? 2 : r < 4.5 ? 3 : 4
}

// ─── Tragaperras del neto (mismo timing entre dígitos que EquipTrack SlotMachineMoney) ────────────
const REST_EASE = 0.5
/** ms en que frena el dígito `ordinal`. Líderes (antes del 1er punto) → (i+1)·2000; resto en los 2 s
 *  siguientes con reparto cóncavo (frac^0.5). Idéntico a EquipTrack. */
function settleAtFor(ordinal: number, leadDigits: number, nDigits: number): number {
  if (ordinal < leadDigits) return (ordinal + 1) * 2000
  const base = leadDigits * 2000
  const restCount = Math.max(1, nDigits - leadDigits)
  const frac = (ordinal - leadDigits + 1) / restCount
  return base + Math.pow(frac, REST_EASE) * 2000
}

/** Un dígito = carrete vertical: gira (pasa por 0-9 varias vueltas) y frena en `targetDigit` con
 *  desaceleración. Usa unidades `em` para alinear con el resto del texto sin medir píxeles. */
function DigitReel({ targetDigit, settleAtMs, runKey }: { targetDigit: number; settleAtMs: number; runKey: string }) {
  const VUELTAS = 8
  const totalCells = VUELTAS * 10 + targetDigit // la última celda muestra targetDigit
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(false)
    let r2 = 0
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setOn(true)) })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
  }, [runKey, targetDigit, settleAtMs])
  const cells = useMemo(() => Array.from({ length: totalCells + 1 }, (_, i) => i % 10), [totalCells])
  return (
    <span style={{ display: 'inline-block', height: '1em', lineHeight: 1, overflow: 'hidden', verticalAlign: 'bottom' }}>
      <span style={{
        display: 'block',
        transform: `translateY(${on ? -totalCells : 0}em)`,
        transition: on ? `transform ${settleAtMs}ms cubic-bezier(.1,.62,.12,1)` : 'none',
      }}>
        {cells.map((d, i) => <span key={i} style={{ display: 'block', height: '1em', lineHeight: 1 }}>{d}</span>)}
      </span>
    </span>
  )
}

export function SlotMachineMoney({ value, onSettled, className }: { value: number; onSettled?: () => void; className?: string }) {
  const finalStr = fmtPesos(value)
  const reduce = reduceMotion()
  const [settled, setSettled] = useState(reduce)

  const { leadDigits, nDigits } = useMemo(() => {
    const dot = finalStr.indexOf('.')
    const lead = dot < 0 ? 1 : Math.max(1, finalStr.slice(0, dot).replace(/\D/g, '').length)
    const n = finalStr.replace(/\D/g, '').length
    return { leadDigits: lead, nDigits: n }
  }, [finalStr])

  const totalMs = useMemo(() => settleAtFor(nDigits - 1, leadDigits, nDigits) + 250, [nDigits, leadDigits])

  useEffect(() => {
    if (reduce) { setSettled(true); onSettled?.(); return }
    setSettled(false)
    const t = setTimeout(() => { setSettled(true); onSettled?.() }, totalMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, totalMs, reduce])

  if (reduce || settled) return <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{finalStr}</span>

  let ordinal = -1
  return (
    <span className={className} style={{ display: 'inline-flex', fontVariantNumeric: 'tabular-nums' }}>
      {finalStr.split('').map((c, i) => {
        if (/\d/.test(c)) {
          ordinal++
          return <DigitReel key={i} targetDigit={Number(c)} settleAtMs={settleAtFor(ordinal, leadDigits, nDigits)} runKey={String(value)} />
        }
        return <span key={i}>{c}</span>
      })}
    </span>
  )
}

// ─── Festejo: billetes + monedas + confeti + rayos + flash + jackpot (escalado por nivel) ─────────
function Billete() {
  return (
    <svg width="28" height="15" viewBox="0 0 28 15" aria-hidden>
      <rect x="0.5" y="0.5" width="27" height="14" rx="2" fill="#16a34a" stroke="#15803d" />
      <circle cx="14" cy="7.5" r="3.6" fill="#22c55e" />
      <text x="14" y="10.3" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#dcfce7">$</text>
    </svg>
  )
}
function Moneda() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="8" fill="#fbbf24" stroke="#d97706" strokeWidth="1.2" />
      <circle cx="9" cy="9" r="5.6" fill="none" stroke="#f59e0b" strokeWidth="0.8" />
      <text x="9" y="12.2" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#92400e">$</text>
    </svg>
  )
}

const CONFETTI = ['#34d399', '#fbbf24', '#f87171', '#60a5fa', '#a78bfa', '#fb923c']
const cssVars = (rot: number, drift: number): CSSProperties => ({ ['--bill-rot']: `${rot}deg`, ['--bill-drift']: `${drift}px` } as CSSProperties)

export function BilletesRain({ nivel, onDone }: { nivel: number; onDone?: () => void }) {
  const reduce = reduceMotion()
  const n = Math.max(0, Math.min(4, nivel))

  const billetes = useMemo(() => Array.from({ length: [12, 18, 28, 40, 56][n] }, () => ({
    left: Math.random() * 100, delay: Math.random() * 0.9, dur: 1.7 + Math.random() * 1.6,
    rot: Math.round((Math.random() - 0.5) * 620), drift: Math.round((Math.random() - 0.5) * 95),
    sway: 0.55 + Math.random() * 0.8,
  })), [n])
  const monedas = useMemo(() => Array.from({ length: [0, 4, 12, 20, 30][n] }, () => ({
    left: Math.random() * 100, delay: Math.random() * 1.0, dur: 1.5 + Math.random() * 1.3,
  })), [n])
  const confeti = useMemo(() => Array.from({ length: [0, 0, 0, 26, 44][n] }, () => ({
    left: Math.random() * 100, delay: Math.random() * 1.0, dur: 1.8 + Math.random() * 1.5,
    rot: Math.round((Math.random() - 0.5) * 900), drift: Math.round((Math.random() - 0.5) * 130),
    color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)], w: 6 + Math.random() * 5,
  })), [n])

  useEffect(() => {
    if (reduce) { onDone?.(); return }
    const t = setTimeout(() => onDone?.(), n >= 4 ? 4400 : 3700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, n])

  if (reduce) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {/* Flash del "momento del premio" */}
      <div className="absolute inset-0" style={{
        animation: 'festejo-flash 800ms ease-out forwards',
        background: n >= 4
          ? 'radial-gradient(circle at 50% 36%, rgba(251,191,36,0.55), transparent 60%)'
          : 'radial-gradient(circle at 50% 40%, rgba(52,211,153,0.34), transparent 62%)',
      }} />
      {/* Rayos dorados girando (niveles altos) */}
      {n >= 3 && (
        <div className="absolute left-1/2 top-[34%]" style={{
          width: '150vmax', height: '150vmax', transform: 'translate(-50%, -50%)',
          animation: 'rays-spin 9s linear infinite, festejo-fade 3.6s ease-out forwards',
          background: 'repeating-conic-gradient(from 0deg, rgba(251,191,36,0.14) 0deg 5deg, transparent 5deg 15deg)',
        }} />
      )}
      {/* Billetes (con balanceo) */}
      {billetes.map((b, i) => (
        <div key={`b${i}`} style={{ position: 'absolute', left: `${b.left}%`, top: '-7%', animation: `bill-fall ${b.dur}s linear ${b.delay}s forwards`, ...cssVars(b.rot, b.drift) }}>
          <div style={{ animation: `bill-sway ${b.sway}s ease-in-out ${b.delay}s infinite alternate` }}><Billete /></div>
        </div>
      ))}
      {/* Monedas (giran 3D) */}
      {monedas.map((m, i) => (
        <div key={`m${i}`} style={{ position: 'absolute', left: `${m.left}%`, top: '-7%', animation: `bill-fall ${m.dur}s linear ${m.delay}s forwards` }}>
          <div style={{ animation: 'coin-spin 0.5s linear infinite' }}><Moneda /></div>
        </div>
      ))}
      {/* Confeti (niveles altos) */}
      {confeti.map((c, i) => (
        <div key={`c${i}`} style={{ position: 'absolute', left: `${c.left}%`, top: '-7%', width: c.w, height: c.w * 0.5, background: c.color, borderRadius: 1, animation: `bill-fall ${c.dur}s linear ${c.delay}s forwards`, ...cssVars(c.rot, c.drift) }} />
      ))}
      {/* Jackpot */}
      {n >= 4 && (
        <div className="absolute inset-x-0 top-[28%] flex justify-center">
          <span className="text-4xl font-black tracking-tight" style={{
            color: '#fde047', textShadow: '0 0 20px rgba(251,191,36,0.95), 0 2px 0 #b45309',
            animation: 'jackpot-zoom 2.8s cubic-bezier(.2,1.35,.4,1) forwards',
          }}>¡JACKPOT!</span>
        </div>
      )}
    </div>
  )
}
