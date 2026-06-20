// Efectos del "festejo" del neto en Proyección Salarial (toggle): tragaperras + lluvia de billetes.
// Versión LIVIANA del easter egg de EquipTrack (sin video): la animación es CSS pura (transform/keyframes).
import { useEffect, useMemo, useState } from 'react'
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

// ─── Lluvia de billetes (proporcional al nivel) + jackpot en el nivel máximo ──────────────────────
function Billete() {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden>
      <rect x="0.5" y="0.5" width="25" height="13" rx="2" fill="#16a34a" stroke="#15803d" />
      <circle cx="13" cy="7" r="3.4" fill="#22c55e" />
      <text x="13" y="9.6" textAnchor="middle" fontSize="6.5" fontWeight="bold" fill="#dcfce7">$</text>
    </svg>
  )
}

export function BilletesRain({ nivel, onDone }: { nivel: number; onDone?: () => void }) {
  const reduce = reduceMotion()
  const n = Math.max(0, Math.min(4, nivel))
  const cantidad = [10, 16, 24, 34, 48][n]
  const billetes = useMemo(() => Array.from({ length: cantidad }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.9,
    dur: 1.7 + Math.random() * 1.5,
    rot: Math.round((Math.random() - 0.5) * 540),
    drift: Math.round((Math.random() - 0.5) * 80),
  })), [cantidad])

  useEffect(() => {
    if (reduce) { onDone?.(); return }
    const t = setTimeout(() => onDone?.(), 3400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce])

  if (reduce) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {billetes.map((b, i) => (
        <div key={i} style={{
          position: 'absolute', left: `${b.left}%`, top: '-6%',
          animation: `bill-fall ${b.dur}s linear ${b.delay}s forwards`,
          ['--bill-rot' as string]: `${b.rot}deg`,
          ['--bill-drift' as string]: `${b.drift}px`,
        } as React.CSSProperties}>
          <Billete />
        </div>
      ))}
      {n >= 4 && (
        <div className="absolute inset-x-0 top-1/3 flex justify-center" style={{ animation: 'jackpot-flash 2.4s ease-out forwards' }}>
          <span className="text-3xl font-black text-amber-300" style={{ textShadow: '0 0 14px rgba(251,191,36,0.85)' }}>¡JACKPOT!</span>
        </div>
      )}
    </div>
  )
}
