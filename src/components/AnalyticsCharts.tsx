import { useEffect, useState } from 'react'
import type { PeriodoStats } from '../hooks/useAnalytics'

// Paleta alineada con ResumenBar: normales (sky), 50% (amber), 100% (orange)
const C_NORM = '#38bdf8'
const C_50 = '#fbbf24'
const C_100 = '#fb923c'
const C_EXTRA = '#fbbf24'

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

// ─── Barras apiladas: horas por período (normales / 50% / 100%) ────────────────
export function StackedBars({ periodos }: { periodos: PeriodoStats[] }) {
  const mounted = useMounted()

  const W = 320, H = 200, padTop = 20, padBottom = 30, padX = 14
  const baselineY = H - padBottom
  const plotH = H - padTop - padBottom
  const n = periodos.length

  const maxVal = Math.max(1, ...periodos.map(p => p.total))
  const maxHead = maxVal * 1.15

  const slot = (W - 2 * padX) / n
  const barW = Math.min(50, slot * 0.52)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Horas por período">
      {/* Líneas guía */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => {
        const y = baselineY - f * plotH
        return <line key={i} x1={padX} y1={y} x2={W - padX} y2={y} stroke="#1e293b" strokeWidth={1} />
      })}
      <line x1={padX} y1={baselineY} x2={W - padX} y2={baselineY} stroke="#334155" strokeWidth={1.5} />

      {periodos.map((p, i) => {
        const cx = padX + slot * i + slot / 2
        const x = cx - barW / 2
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
          return (
            <rect key={si} x={x} y={y} width={barW} height={h} fill={s.c}
              rx={si === segs.length - 1 || segs.slice(si + 1).every(z => z.v <= 0) ? 4 : 0} />
          )
        })
        const totalH = (p.total / maxHead) * plotH
        const isCurrent = i === n - 1
        return (
          <g key={i}>
            {/* Barra (escala desde la base) */}
            <g style={{
              transformBox: 'fill-box',
              transformOrigin: 'bottom',
              transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
              transition: 'transform 650ms cubic-bezier(.22,1,.36,1)',
              transitionDelay: `${i * 110}ms`,
              opacity: p.total > 0 ? 1 : 0.35,
            }}>
              {p.total > 0 ? rects : (
                <rect x={x} y={baselineY - 3} width={barW} height={3} rx={1.5} fill="#334155" />
              )}
            </g>
            {/* Valor total arriba de la barra */}
            {p.total > 0 && (
              <text x={cx} y={baselineY - totalH - 7} textAnchor="middle"
                fontSize={12} fontWeight={700} fill="#e2e8f0"
                style={{ opacity: mounted ? 1 : 0, transition: 'opacity 400ms ease', transitionDelay: `${i * 110 + 350}ms` }}>
                {fmt(p.total)}
              </text>
            )}
            {/* Etiqueta del mes */}
            <text x={cx} y={H - 11} textAnchor="middle" fontSize={11}
              fontWeight={isCurrent ? 700 : 500} fill={isCurrent ? '#7dd3fc' : '#94a3b8'}>
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Líneas de tendencia: total trabajadas + horas extra ───────────────────────
export function TrendLines({ periodos }: { periodos: PeriodoStats[] }) {
  const mounted = useMounted()

  const W = 320, H = 176, padTop = 18, padBottom = 26, padX = 24
  const baselineY = H - padBottom
  const plotH = H - padTop - padBottom
  const plotW = W - 2 * padX
  const n = periodos.length

  const maxVal = Math.max(1, ...periodos.map(p => p.total))
  const maxHead = maxVal * 1.15

  const x = (i: number) => (n <= 1 ? W / 2 : padX + (plotW * i) / (n - 1))
  const y = (v: number) => baselineY - (v / maxHead) * plotH

  const ptsTotal = periodos.map((p, i) => [x(i), y(p.total)] as const)
  const ptsExtra = periodos.map((p, i) => [x(i), y(p.extra)] as const)

  const toPath = (pts: readonly (readonly [number, number])[]) =>
    pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')

  const areaPath =
    `${toPath(ptsTotal)} L${x(n - 1).toFixed(1)},${baselineY} L${x(0).toFixed(1)},${baselineY} Z`

  const drawStyle = (delay: number) => ({
    strokeDasharray: 1,
    strokeDashoffset: mounted ? 0 : 1,
    transition: 'stroke-dashoffset 900ms ease',
    transitionDelay: `${delay}ms`,
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Tendencia de horas">
      <defs>
        <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C_NORM} stopOpacity={0.28} />
          <stop offset="100%" stopColor={C_NORM} stopOpacity={0} />
        </linearGradient>
      </defs>

      {[0.5, 1].map((f, i) => (
        <line key={i} x1={padX} y1={baselineY - f * plotH} x2={W - padX} y2={baselineY - f * plotH}
          stroke="#1e293b" strokeWidth={1} />
      ))}
      <line x1={padX} y1={baselineY} x2={W - padX} y2={baselineY} stroke="#334155" strokeWidth={1.5} />

      {/* Área bajo "trabajadas" */}
      <path d={areaPath} fill="url(#trend-area)"
        style={{ opacity: mounted ? 1 : 0, transition: 'opacity 700ms ease', transitionDelay: '300ms' }} />

      {/* Línea horas extra */}
      <path d={toPath(ptsExtra)} fill="none" stroke={C_EXTRA} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" pathLength={1}
        style={drawStyle(250)} opacity={0.85} />

      {/* Línea total trabajadas */}
      <path d={toPath(ptsTotal)} fill="none" stroke={C_NORM} strokeWidth={2.5}
        strokeLinecap="round" strokeLinejoin="round" pathLength={1} style={drawStyle(0)} />

      {/* Puntos + valores */}
      {periodos.map((p, i) => {
        const isCurrent = i === n - 1
        const delay = 700 + i * 90
        return (
          <g key={i} style={{ opacity: mounted ? 1 : 0, transition: 'opacity 350ms ease', transitionDelay: `${delay}ms` }}>
            {p.extra > 0 && <circle cx={x(i)} cy={y(p.extra)} r={3} fill="#0f172a" stroke={C_EXTRA} strokeWidth={2} />}
            <circle cx={x(i)} cy={y(p.total)} r={isCurrent ? 4.5 : 3.5} fill="#0f172a" stroke={C_NORM} strokeWidth={2.5} />
            <text x={x(i)} y={y(p.total) - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="#e2e8f0">
              {fmt(p.total)}
            </text>
            <text x={x(i)} y={H - 9} textAnchor="middle" fontSize={11}
              fontWeight={isCurrent ? 700 : 500} fill={isCurrent ? '#7dd3fc' : '#94a3b8'}>
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
