import { useEffect, useState } from 'react'
import type { PeriodoStats } from '../hooks/useAnalytics'

// Paleta alineada con ResumenBar: normales (sky), 50% (amber), 100% (orange)
const C_NORM = '#38bdf8'
const C_50 = '#fbbf24'
const C_100 = '#fb923c'
const C_TOTAL = '#e2e8f0' // línea del total: contrasta con las barras de colores

/** Dispara la animación de entrada una vez montado el componente. */
function useMounted(): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return m
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ─── Evolución: barras apiladas (normales/50/100) + línea de total superpuesta ──
// Unifica las antiguas "Horas por período" (barras) y "Tendencia" (líneas): las barras
// muestran la composición por período y la línea conecta los topes resaltando la trayectoria.
export function EvolucionChart({ periodos }: { periodos: PeriodoStats[] }) {
  const mounted = useMounted()

  const W = 320, H = 212, padTop = 26, padBottom = 30, padX = 18
  const baselineY = H - padBottom
  const plotH = H - padTop - padBottom
  const n = periodos.length

  const maxVal = Math.max(1, ...periodos.map(p => p.total))
  const maxHead = maxVal * 1.2 // headroom para puntos + etiquetas

  const slot = (W - 2 * padX) / n
  const barW = Math.min(46, slot * 0.46)

  const cx = (i: number) => padX + slot * i + slot / 2
  const yOf = (v: number) => baselineY - (v / maxHead) * plotH

  // Línea del total sobre los topes de las barras.
  const ptsTotal = periodos.map((p, i) => [cx(i), yOf(p.total)] as const)
  const linePath = ptsTotal
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolución de horas por período">
      {/* Líneas guía */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => {
        const y = baselineY - f * plotH
        return <line key={i} x1={padX} y1={y} x2={W - padX} y2={y} stroke="#1e293b" strokeWidth={1} />
      })}
      <line x1={padX} y1={baselineY} x2={W - padX} y2={baselineY} stroke="#334155" strokeWidth={1.5} />

      {/* Barras apiladas (crecen desde la base) */}
      {periodos.map((p, i) => {
        const x = cx(i) - barW / 2
        const segs = [
          { v: p.normales, c: C_NORM },
          { v: p.al50, c: C_50 },
          { v: p.al100, c: C_100 },
        ]
        let yCursor = baselineY
        const rects = segs.map((s, si) => {
          if (s.v <= 0) return null
          const h = (s.v / maxHead) * plotH
          const y = yCursor - h
          yCursor = y
          const isTop = segs.slice(si + 1).every(z => z.v <= 0)
          return <rect key={si} x={x} y={y} width={barW} height={h} fill={s.c} rx={isTop ? 4 : 0} />
        })
        return (
          <g key={i} style={{
            transformBox: 'fill-box',
            transformOrigin: 'bottom',
            transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
            transition: 'transform 650ms cubic-bezier(.22,1,.36,1)',
            transitionDelay: `${i * 110}ms`,
            opacity: p.total > 0 ? 1 : 0.4,
          }}>
            {p.total > 0 ? rects : <rect x={x} y={baselineY - 3} width={barW} height={3} rx={1.5} fill="#334155" />}
          </g>
        )
      })}

      {/* Línea del total (se dibuja tras subir las barras) */}
      <path d={linePath} fill="none" stroke={C_TOTAL} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1}
        style={{ strokeDashoffset: mounted ? 0 : 1, transition: 'stroke-dashoffset 900ms ease', transitionDelay: '420ms' }} />

      {/* Puntos + valor del total + etiqueta del mes */}
      {periodos.map((p, i) => {
        const isCurrent = i === n - 1
        const px = cx(i), py = yOf(p.total)
        const delay = 760 + i * 90
        return (
          <g key={i}>
            <g style={{ opacity: mounted ? 1 : 0, transition: 'opacity 350ms ease', transitionDelay: `${delay}ms` }}>
              <circle cx={px} cy={py} r={isCurrent ? 4.5 : 3.5} fill="#0f172a" stroke={C_TOTAL} strokeWidth={2.5} />
              <text x={px} y={py - 9} textAnchor="middle" fontSize={12} fontWeight={700} fill="#f1f5f9">{fmt(p.total)}</text>
            </g>
            <text x={px} y={H - 10} textAnchor="middle" fontSize={11}
              fontWeight={isCurrent ? 700 : 500} fill={isCurrent ? '#7dd3fc' : '#94a3b8'}>{p.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
