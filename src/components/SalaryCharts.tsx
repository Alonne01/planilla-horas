// Gráficos y tarjetas de la pantalla de Proyección Salarial (recharts).
// Componentes presentacionales: la página arma los datos y acá sólo se renderizan.
import { useEffect, useRef, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar, ComposedChart, Line,
} from 'recharts'
import { fmtPesos } from '../lib/calculo-salarial'

// Paleta unificada (emerald = plata/neto, sky = fijos/normales, amber/orange = variables/extras,
// violet = no-rem, red = retenciones), alineada con AnalyticsCharts/ResumenBar.
export const SC = {
  neto: '#34d399', fijos: '#38bdf8', variables: '#fbbf24', noRem: '#a78bfa',
  retenciones: '#f87171', normal: '#38bdf8', extra: '#fb923c', campo: '#34d399', base: '#60a5fa',
}

/** Pesos en formato corto para ejes/labels: $1,2M · $850K. */
export function fmtMoneyShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

const reduceMotion = typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Anima un número desde su valor mostrado actual hasta `target` (easeOutCubic). */
export function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(target)
  const valRef = useRef(target)
  valRef.current = val
  useEffect(() => {
    const from = valRef.current
    if (reduceMotion || Math.abs(from - target) < 0.5) { setVal(target); return }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else setVal(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-slate-900/95 border border-slate-700 px-2.5 py-1.5 shadow-lg">
      {label != null && <div className="text-[10px] text-slate-400 mb-0.5">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="font-semibold tabular-nums" style={{ color: p.color || '#e2e8f0' }}>{fmtPesos(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Badge de variación del neto vs mes anterior (en $) ───────────────────────────
export function DeltaBadge({ cur, prev }: { cur: number; prev: number }) {
  const d = cur - prev
  const pct = prev > 0 ? (d / prev) * 100 : (cur > 0 ? 100 : 0)
  if (prev <= 0 || Math.abs(d) < prev * 0.001) {
    return <div className="flex items-center gap-1 text-slate-400 text-xs font-medium"><Minus size={14} /> Sin cambio</div>
  }
  const up = d > 0
  const color = up ? 'text-emerald-300' : 'text-red-300'
  return (
    <div className={`flex flex-col items-end ${color}`}>
      <div className="flex items-center gap-1 text-sm font-bold">
        {up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
        {up ? '+' : '−'}{fmtMoneyShort(Math.abs(d))}
      </div>
      <div className="text-[10px] opacity-80">{up ? '+' : '−'}{Math.abs(pct).toFixed(0)}% vs mes anterior</div>
    </div>
  )
}

// ─── Tendencia del neto mes a mes (área) ──────────────────────────────────────────
export function TendenciaNetoChart({ data }: { data: { label: string; neto: number }[] }) {
  if (data.length < 2) {
    return <div className="text-center text-xs text-slate-500 py-8">Cargá al menos dos meses para ver la tendencia.</div>
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="sc-neto" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SC.neto} stopOpacity={0.32} />
            <stop offset="100%" stopColor={SC.neto} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#475569', strokeDasharray: '4 4' }} />
        <Area type="monotone" dataKey="neto" name="Neto" stroke={SC.neto} strokeWidth={2.5}
          fill="url(#sc-neto)" dot={{ r: 3, fill: '#0f172a', stroke: SC.neto, strokeWidth: 2 }}
          activeDot={{ r: 5 }} isAnimationActive={!reduceMotion} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Tendencia ACUMULADA intra-período: cobrado real (sólido) vs proyección al fin (punteado) ─────
export function TendenciaAcumuladaChart({ data, proyectado }: {
  data: { label: string; real: number }[]; proyectado: number | null
}) {
  if (data.length < 2) {
    return <div className="text-center text-xs text-slate-500 py-8">Cargá más días para ver la curva acumulada.</div>
  }
  const serie: { label: string; real?: number; proy?: number }[] = data.map((d, i) => ({
    label: d.label,
    real: d.real,
    proy: (proyectado != null && i === data.length - 1) ? d.real : undefined, // conecta el último real con la proyección
  }))
  if (proyectado != null) serie.push({ label: 'fin', proy: proyectado })
  return (
    <>
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="sc-acum" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SC.neto} stopOpacity={0.28} />
              <stop offset="100%" stopColor={SC.neto} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#475569', strokeDasharray: '4 4' }} />
          <Area type="monotone" dataKey="real" name="Cobrado real" stroke={SC.neto} strokeWidth={2.5}
            fill="url(#sc-acum)" connectNulls dot={false} isAnimationActive={!reduceMotion} />
          <Line type="monotone" dataKey="proy" name="Proyección" stroke={SC.variables} strokeWidth={2}
            strokeDasharray="6 5" dot={false} connectNulls isAnimationActive={!reduceMotion} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SC.neto }} />Cobrado real</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: SC.variables }} />Proyección</span>
      </div>
    </>
  )
}

// ─── Composición del bruto (donut Fijos/Variables/No-rem) + barra Bruto→Ret→Neto ──
export function ComposicionCard({ fijos, variables, noRem, retenciones, bruto, neto }: {
  fijos: number; variables: number; noRem: number; retenciones: number; bruto: number; neto: number
}) {
  const comp = [
    { name: 'Fijos', value: Math.max(0, fijos), fill: SC.fijos },
    { name: 'Variables', value: Math.max(0, variables), fill: SC.variables },
    { name: 'No remun.', value: Math.max(0, noRem), fill: SC.noRem },
  ].filter(s => s.value > 0)
  const retPct = bruto > 0 ? (retenciones / bruto) * 100 : 0
  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie data={comp} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82}
              paddingAngle={2} stroke="none" isAnimationActive={!reduceMotion}>
              {comp.map((s, i) => <Cell key={i} fill={s.fill} />)}
            </Pie>
            <Tooltip content={<MoneyTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[10px] text-slate-400">Bruto</div>
          <div className="text-lg font-bold text-white tabular-nums">{fmtMoneyShort(bruto)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1">
        {comp.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.fill }} />
            {s.name} <span className="text-slate-300 font-semibold">{fmtMoneyShort(s.value)}</span>
          </div>
        ))}
      </div>
      {/* Barra Bruto → −Retenciones → Neto */}
      <div className="mt-4">
        <div className="flex h-3 rounded-full overflow-hidden bg-slate-700/40">
          <div className="bg-emerald-500" style={{ width: `${100 - retPct}%` }} title="Neto" />
          <div className="bg-red-400/80" style={{ width: `${retPct}%` }} title="Retenciones" />
        </div>
        <div className="flex justify-between text-[11px] mt-1.5">
          <span className="text-emerald-300">Neto {fmtPesos(neto)}</span>
          <span className="text-red-300">Retenciones {retPct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  )
}

// ─── Ganancia estimada por día (barras apiladas Normal/Extras) ────────────────────
export function GananciaDiaCard({ data }: { data: { dia: string; normal: number; extra: number }[] }) {
  if (data.length < 1) return null
  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 14)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={2}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#1e293b55' }} />
          <Bar dataKey="normal" name="Normal" stackId="a" fill={SC.normal} radius={[2, 0, 0, 2]} isAnimationActive={!reduceMotion} />
          <Bar dataKey="extra" name="Extras" stackId="a" fill={SC.extra} radius={[0, 2, 2, 0]} isAnimationActive={!reduceMotion} />
        </BarChart>
      </ResponsiveContainer>
      <Legend items={[{ c: SC.normal, t: 'Normal' }, { c: SC.extra, t: 'Extras' }]} />
    </>
  )
}

// ─── Mini-dona de distribución (un valor vs el resto) ─────────────────────────────
export function MiniDonut({ pct, label, sub, color }: { pct: number; label: string; sub: string; color: string }) {
  const data = [{ name: label, value: pct }, { name: 'resto', value: Math.max(0, 100 - pct) }]
  return (
    <div className="relative flex flex-col items-center">
      <div className="relative w-[110px] h-[110px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={38} outerRadius={50} startAngle={90} endAngle={-270}
              stroke="none" isAnimationActive={!reduceMotion}>
              <Cell fill={color} />
              <Cell fill="#334155" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-base font-bold text-white tabular-nums">{sub}</div>
        </div>
      </div>
      <div className="text-[11px] text-slate-400 -mt-1">{label}</div>
    </div>
  )
}

function Legend({ items }: { items: { c: string; t: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: it.c }} />{it.t}
        </div>
      ))}
    </div>
  )
}

// ─── KPIs (grilla de 2×2) ─────────────────────────────────────────────────────────
export function KpiGrid({ items }: { items: { label: string; value: string; accent?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((k, i) => (
        <div key={i} className="rounded-xl bg-slate-800/80 border border-slate-700/50 p-3">
          <div className="text-[11px] text-slate-400">{k.label}</div>
          <div className={`text-lg font-bold mt-0.5 tabular-nums ${k.accent ?? 'text-white'}`}>{k.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Proyección fin de período ────────────────────────────────────────────────────
export function ProyeccionCard({ pct, diasTxt, neto, proyectado }: {
  pct: number; diasTxt: string; neto: number; proyectado: number
}) {
  const proyAnim = useCountUp(proyectado)
  const falta = Math.max(0, proyectado - neto)
  return (
    <div className="rounded-2xl bg-gradient-to-br from-violet-900/40 to-slate-800/60 border border-violet-800/40 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-200">Proyección fin de período</div>
          <div className="text-[11px] text-slate-400">{diasTxt}</div>
        </div>
        <div className="text-xl font-bold text-white tabular-nums">{fmtPesos(Math.round(proyAnim))}</div>
      </div>
      <div className="mt-3 h-2.5 rounded-full bg-slate-700/50 overflow-hidden">
        <div className="h-full bg-violet-400 rounded-full transition-[width] duration-700" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <div className="flex justify-between mt-2 text-[11px]">
        <span className="text-slate-400">Cobrado ahora <span className="text-slate-200 font-semibold">{fmtPesos(neto)}</span></span>
        <span className="text-slate-400">Falta <span className="text-violet-300 font-semibold">{fmtPesos(falta)}</span></span>
      </div>
    </div>
  )
}
