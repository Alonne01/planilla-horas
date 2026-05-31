import { useState } from 'react'
import {
  BarChart3, Activity, TrendingUp, TrendingDown, Minus,
  Briefcase, Clock, Plane, Truck, BedDouble, Sun, Banknote, Gauge,
} from 'lucide-react'
import { useAnalytics, shiftPeriodo, MESES_ES } from '../hooks/useAnalytics'
import type { PeriodoStats } from '../hooks/useAnalytics'
import { StackedBars, TrendLines } from '../components/AnalyticsCharts'
import { defaultPeriodoMes, defaultPeriodoAnio } from '../lib/diagrama'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function AnalyticsPage() {
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const { periodos, loading } = useAnalytics(mes, anio, 2)

  function cambiarMes(delta: number) {
    const { mes: m, anio: a } = shiftPeriodo(mes, anio, delta)
    setMes(m); setAnio(a)
  }

  const actual = periodos[periodos.length - 1]
  const anterior = periodos[periodos.length - 2]
  const hayDatos = periodos.some(p => p.total > 0 || p.diasFranco > 0 || p.viaje > 0)

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => cambiarMes(-1)} className="p-2 text-slate-400 active:text-white">‹</button>
          <div className="text-center">
            <div className="text-base font-bold text-white flex items-center gap-1.5 justify-center">
              <BarChart3 size={16} className="text-sky-400" /> Análisis
            </div>
            <div className="text-xs text-slate-500">{MESES_ES[mes]} {anio} y 2 períodos previos</div>
          </div>
          <button onClick={() => cambiarMes(1)} className="p-2 text-slate-400 active:text-white">›</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-500 py-16">Cargando…</div>
      ) : !hayDatos ? (
        <div className="px-6 py-16 text-center text-slate-500">
          <BarChart3 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hay datos cargados en estos períodos.</p>
          <p className="text-xs text-slate-600 mt-1">Cargá horas en la pantalla de Horas para ver el análisis.</p>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {/* ─── KPIs ─── */}
          <Section delay={0}>
            <div className="rounded-2xl bg-gradient-to-br from-sky-900/40 to-slate-800/60 border border-sky-800/40 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-sky-300/80">Horas trabajadas · {actual.rango}</div>
                  <div className="text-4xl font-bold text-white leading-none mt-1">{fmt(actual.total)}<span className="text-lg font-medium text-slate-400 ml-1">hs</span></div>
                </div>
                <DeltaBadge cur={actual.total} prev={anterior?.total ?? 0} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Kpi icon={<Briefcase size={15} />} label="Días trab." value={String(actual.diasTrabajados)} />
              <Kpi icon={<Clock size={15} />} label="Hs extra" value={fmt(actual.extra)} accent="text-amber-300" />
              <Kpi icon={<Plane size={15} />} label="Hs viaje" value={fmt(actual.viaje)} />
            </div>
          </Section>

          {/* ─── Gráfico de barras ─── */}
          <Section delay={80}>
            <Card title="Horas por período" icon={<BarChart3 size={15} className="text-sky-400" />}>
              <StackedBars periodos={periodos} />
              <Legend items={[
                { c: '#38bdf8', t: 'Normales' },
                { c: '#fbbf24', t: 'Al 50%' },
                { c: '#fb923c', t: 'Al 100%' },
              ]} />
            </Card>
          </Section>

          {/* ─── Gráfico de líneas ─── */}
          <Section delay={160}>
            <Card title="Tendencia" icon={<Activity size={15} className="text-sky-400" />}>
              <TrendLines periodos={periodos} />
              <Legend items={[
                { c: '#38bdf8', t: 'Trabajadas' },
                { c: '#fbbf24', t: 'Extra (50/100%)', dashed: true },
              ]} />
            </Card>
          </Section>

          {/* ─── Distribución del período actual ─── */}
          <Section delay={240}>
            <Card title="Distribución del período" icon={<Gauge size={15} className="text-sky-400" />}>
              <SplitBar campo={actual.diasCampo} base={actual.diasBase} franco={actual.diasFranco} />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <MiniStat icon={<Gauge size={14} />} label="Promedio / día" value={`${fmt(actual.promedioPorDia)} hs`} />
                <MiniStat icon={<BedDouble size={14} />} label="Pernoctes" value={String(actual.pernoctes)} />
                <MiniStat icon={<Truck size={14} />} label="Días manejó" value={String(actual.diasManejo)} />
                <MiniStat icon={<Banknote size={14} />} label="Francos trab." value={String(actual.francosTrabajados)} />
                {actual.feriadosTrabajados > 0 &&
                  <MiniStat icon={<Sun size={14} />} label="Feriados trab." value={String(actual.feriadosTrabajados)} />}
              </div>
            </Card>
          </Section>

          {/* ─── Comparativa numérica ─── */}
          <Section delay={320}>
            <Card title="Comparativa" icon={<TrendingUp size={15} className="text-sky-400" />}>
              <CompareTable periodos={periodos} />
            </Card>
          </Section>
        </div>
      )}
    </div>
  )
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────────

function Section({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <div className="animate-[analytics-rise_420ms_ease_both]" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function DeltaBadge({ cur, prev }: { cur: number; prev: number }) {
  const d = cur - prev
  const pct = prev > 0 ? (d / prev) * 100 : (cur > 0 ? 100 : 0)
  const rounded = Math.round(d * 10) / 10
  if (Math.abs(rounded) < 0.05) {
    return (
      <div className="flex items-center gap-1 text-slate-400 text-sm font-medium">
        <Minus size={15} /> Igual
      </div>
    )
  }
  const up = d > 0
  const color = up ? 'text-sky-300' : 'text-amber-400'
  return (
    <div className={`flex flex-col items-end ${color}`}>
      <div className="flex items-center gap-1 text-sm font-bold">
        {up ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        {up ? '+' : ''}{fmt(rounded)} hs
      </div>
      <div className="text-[11px] opacity-80">{up ? '+' : ''}{pct.toFixed(0)}% vs anterior</div>
    </div>
  )
}

function Kpi({ icon, label, value, accent = 'text-white' }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700/50 p-3">
      <div className="flex items-center gap-1 text-slate-500">{icon}</div>
      <div className={`text-xl font-bold mt-1 ${accent}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  )
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-800/50 border border-slate-700/40 px-3 py-2">
      <span className="text-slate-500 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold text-white leading-tight">{value}</div>
        <div className="text-[10px] text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}

function Legend({ items }: { items: { c: string; t: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="inline-block rounded-full" style={{
            width: 10, height: it.dashed ? 0 : 10, borderRadius: 9999,
            ...(it.dashed
              ? { borderTop: `2px dashed ${it.c}`, width: 12 }
              : { background: it.c }),
          }} />
          {it.t}
        </div>
      ))}
    </div>
  )
}

function SplitBar({ campo, base, franco }: { campo: number; base: number; franco: number }) {
  const total = campo + base + franco
  const segs = [
    { v: campo, c: 'bg-emerald-500', t: 'Campo' },
    { v: base, c: 'bg-blue-500', t: 'Base' },
    { v: franco, c: 'bg-slate-600', t: 'Franco' },
  ].filter(s => s.v > 0)
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-700/40">
        {total > 0 ? segs.map((s, i) => (
          <div key={i} className={s.c} style={{ width: `${(s.v / total) * 100}%` }} title={`${s.t}: ${s.v}`} />
        )) : <div className="w-full" />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.c}`} />
            {s.t} <span className="text-slate-300 font-semibold">{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompareTable({ periodos }: { periodos: PeriodoStats[] }) {
  const rows: { label: string; get: (p: PeriodoStats) => string }[] = [
    { label: 'Trabajadas', get: p => `${fmt(p.total)} hs` },
    { label: 'Al 50%', get: p => fmt(p.al50) },
    { label: 'Al 100%', get: p => fmt(p.al100) },
    { label: 'Viaje', get: p => fmt(p.viaje) },
    { label: 'Días trab.', get: p => String(p.diasTrabajados) },
    { label: 'Promedio/día', get: p => `${fmt(p.promedioPorDia)} hs` },
  ]
  const lastIdx = periodos.length - 1
  return (
    <div className="overflow-hidden rounded-xl border border-slate-700/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800/80 text-slate-400">
            <th className="text-left font-medium px-3 py-2 text-xs"></th>
            {periodos.map((p, i) => (
              <th key={i} className={`text-right font-semibold px-3 py-2 text-xs ${i === lastIdx ? 'text-sky-300' : ''}`}>
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-slate-700/40">
              <td className="text-left text-slate-400 px-3 py-2 text-xs">{r.label}</td>
              {periodos.map((p, i) => (
                <td key={i} className={`text-right px-3 py-2 tabular-nums ${i === lastIdx ? 'text-white font-semibold' : 'text-slate-300'}`}>
                  {r.get(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
