import { useState, useMemo } from 'react'
import {
  BarChart3, TrendingUp, TrendingDown, Minus,
  Briefcase, Clock, Plane, Truck, BedDouble, Sun, Banknote, Gauge, ChevronDown,
} from 'lucide-react'
import { useAnalytics, shiftPeriodo, MESES_ES } from '../hooks/useAnalytics'
import type { PeriodoStats } from '../hooks/useAnalytics'
import { EvolucionChart } from '../components/AnalyticsCharts'
import { MonthPeriodPicker } from '../components/MonthPeriodPicker'
import { defaultPeriodoMes, defaultPeriodoAnio } from '../lib/diagrama'
import { useSettings } from '../hooks/useSettings'
import { calcularSueldo, configFromSettings, isSalaryUser, fmtPesos, type SalaryEstimate } from '../lib/calculo-salarial'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ─── Paleta de acentos por tarjeta/KPI ────────────────────────────────────────────
type Accent = 'sky' | 'emerald' | 'amber' | 'violet'
const ACCENT: Record<Accent, { chip: string; icon: string; text: string }> = {
  sky:     { chip: 'bg-sky-500/10',     icon: 'text-sky-400',     text: 'text-sky-300' },
  emerald: { chip: 'bg-emerald-500/10', icon: 'text-emerald-400', text: 'text-emerald-300' },
  amber:   { chip: 'bg-amber-500/10',   icon: 'text-amber-400',   text: 'text-amber-300' },
  violet:  { chip: 'bg-violet-500/10',  icon: 'text-violet-400',  text: 'text-violet-300' },
}

export function AnalyticsPage() {
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const { settings } = useSettings()
  const { periodos, loading } = useAnalytics(mes, anio, 2, settings.lineaTrabajo)

  function cambiarMes(delta: number) {
    const { mes: m, anio: a } = shiftPeriodo(mes, anio, delta)
    setMes(m); setAnio(a)
  }

  const actual = periodos[periodos.length - 1]
  const anterior = periodos[periodos.length - 2]
  const hayDatos = periodos.some(p => p.total > 0 || p.diasFranco > 0 || p.viaje > 0)

  const showSalary = isSalaryUser(settings.nombreUsuario) && settings.sueldoBasico > 0
  const est = useMemo<SalaryEstimate | null>(
    () => (showSalary && actual ? calcularSueldo(actual.registros, configFromSettings(settings)) : null),
    [showSalary, actual, settings],
  )

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => cambiarMes(-1)} className="p-2 text-slate-400 active:text-white">‹</button>
          <button onClick={() => setShowMonthPicker(true)} className="text-center active:opacity-70 transition-opacity" title="Elegir período">
            <div className="text-base font-bold text-white flex items-center gap-1.5 justify-center">
              <BarChart3 size={16} className="text-sky-400" /> Análisis
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-center gap-1">{MESES_ES[mes]} {anio} y 2 períodos previos <ChevronDown size={12} /></div>
          </button>
          <button onClick={() => cambiarMes(1)} className="p-2 text-slate-400 active:text-white">›</button>
        </div>
      </div>

      {showMonthPicker && (
        <MonthPeriodPicker mes={mes} anio={anio} onSelect={(m, a) => { setMes(m); setAnio(a) }} onClose={() => setShowMonthPicker(false)} />
      )}

      {loading ? (
        <div className="px-4 space-y-4 py-2">
          <div className="h-52 rounded-2xl bg-slate-800/60 animate-pulse" />
          <div className="h-40 rounded-2xl bg-slate-800/60 animate-pulse" style={{ animationDelay: '120ms' }} />
        </div>
      ) : !hayDatos ? (
        <div className="px-6 py-16 text-center text-slate-500">
          <BarChart3 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hay datos cargados en estos períodos.</p>
          <p className="text-xs text-slate-600 mt-1">Cargá horas en la pantalla de Horas para ver el análisis.</p>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {/* ─── Hero + KPIs ─── */}
          <Section delay={0}>
            <div className="rounded-2xl bg-gradient-to-br from-sky-900/50 to-slate-800/60 border border-sky-800/40 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-sky-300/80">Horas trabajadas · {actual.rango}</div>
                  <div className="text-4xl font-bold text-white leading-none mt-1 tabular-nums">
                    {fmt(actual.total)}<span className="text-lg font-medium text-slate-400 ml-1">hs</span>
                  </div>
                </div>
                <DeltaBadge cur={actual.total} prev={anterior?.total ?? 0} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Kpi icon={<Briefcase size={16} />} label="Días trab." value={String(actual.diasTrabajados)} accent="sky" />
              <Kpi icon={<Clock size={16} />} label="Hs extra" value={fmt(actual.extra)} accent="amber" />
              <Kpi icon={<Plane size={16} />} label="Hs viaje" value={fmt(actual.viaje)} accent="violet" />
            </div>
          </Section>

          {/* ─── Estimación salarial (sólo usuario de prueba) ─── */}
          {est && est.diasTrabajados > 0 && (
            <Section delay={40}>
              <SalaryCard est={est} />
            </Section>
          )}

          {/* ─── Evolución (barras apiladas + línea de total) ─── */}
          <Section delay={80}>
            <Card title="Evolución" icon={<BarChart3 size={16} />} accent="sky">
              <EvolucionChart periodos={periodos} />
              <Legend items={[
                { c: '#38bdf8', t: 'Normales' },
                { c: '#fbbf24', t: 'Al 50%' },
                { c: '#fb923c', t: 'Al 100%' },
                { c: '#e2e8f0', t: 'Total', line: true },
              ]} />
            </Card>
          </Section>

          {/* ─── Distribución del período actual ─── */}
          <Section delay={160}>
            <Card title="Distribución del período" icon={<Gauge size={16} />} accent="emerald">
              <SplitBar campo={actual.diasCampo} base={actual.diasBase} franco={actual.diasFranco} />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <MiniStat icon={<Gauge size={15} />} label="Promedio / día" value={`${fmt(actual.promedioPorDia)} hs`} />
                <MiniStat icon={<BedDouble size={15} />} label="Pernoctes" value={String(actual.pernoctes)} />
                <MiniStat icon={<Truck size={15} />} label="Días manejó" value={String(actual.diasManejo)} />
                <MiniStat icon={<Banknote size={15} />} label="Francos trab." value={String(actual.francosTrabajados)} />
                {actual.feriadosTrabajados > 0 &&
                  <MiniStat icon={<Sun size={15} />} label="Feriados trab." value={String(actual.feriadosTrabajados)} />}
              </div>
            </Card>
          </Section>

          {/* ─── Comparativa numérica ─── */}
          <Section delay={240}>
            <Card title="Comparativa" icon={<TrendingUp size={16} />} accent="violet">
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

function Card({ title, icon, accent = 'sky', children }: {
  title: string; icon: React.ReactNode; accent?: Accent; children: React.ReactNode
}) {
  const a = ACCENT[accent]
  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center justify-center rounded-lg p-1.5 ${a.chip} ${a.icon}`}>{icon}</span>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function DeltaBadge({ cur, prev }: { cur: number; prev: number }) {
  const d = cur - prev
  const rounded = Math.round(d * 10) / 10

  // Sin base de comparación (el período previo no tiene horas): evita el "+2575%" engañoso.
  if (prev <= 0) {
    if (cur <= 0) return <div className="text-slate-500 text-xs font-medium">sin comparación</div>
    return (
      <div className="flex flex-col items-end text-sky-300">
        <div className="flex items-center gap-1 text-sm font-bold"><TrendingUp size={16} />+{fmt(rounded)} hs</div>
        <div className="text-[11px] opacity-80">nuevo · 1er período</div>
      </div>
    )
  }
  if (Math.abs(rounded) < 0.05) {
    return <div className="flex items-center gap-1 text-slate-400 text-sm font-medium"><Minus size={15} /> Igual</div>
  }
  const up = d > 0
  const pct = (d / prev) * 100
  const color = up ? 'text-sky-300' : 'text-amber-400'
  // Saltos enormes: mostrar multiplicador ×N en vez de un porcentaje de tres cifras.
  const sub = Math.abs(pct) >= 300
    ? `×${(cur / prev).toFixed(1).replace('.', ',')} vs anterior`
    : `${up ? '+' : ''}${pct.toFixed(0)}% vs anterior`
  return (
    <div className={`flex flex-col items-end ${color}`}>
      <div className="flex items-center gap-1 text-sm font-bold">
        {up ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        {up ? '+' : ''}{fmt(rounded)} hs
      </div>
      <div className="text-[11px] opacity-80">{sub}</div>
    </div>
  )
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: Accent }) {
  const a = ACCENT[accent]
  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700/50 p-3">
      <span className={`inline-flex items-center justify-center rounded-lg p-1.5 ${a.chip} ${a.icon}`}>{icon}</span>
      <div className={`text-xl font-bold mt-2 tabular-nums ${a.text}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  )
}

function SalaryCard({ est }: { est: SalaryEstimate }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-900/40 to-slate-800/60 border border-emerald-800/40 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex items-center justify-center rounded-lg p-1.5 bg-emerald-500/10 text-emerald-400">
          <Banknote size={16} />
        </span>
        <h3 className="text-sm font-semibold text-slate-200">Estimación salarial</h3>
      </div>
      <div className="text-xs text-emerald-300/80 mt-1">Neto estimado</div>
      <div className="text-3xl font-bold text-white leading-none mt-0.5 tabular-nums">{fmtPesos(est.netoEstimado)}</div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <SalMini label="Bruto" value={fmtPesos(est.bruto)} />
        <SalMini label="Retenciones" value={`-${fmtPesos(est.retenciones)}`} accent="text-red-300" />
        <SalMini label="Valor hora" value={fmtPesos(est.horaBase)} />
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Detalle completo en la pestaña Proyección.</p>
    </div>
  )
}

function SalMini({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700/50 px-2.5 py-2">
      <div className={`text-sm font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  )
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40 px-3 py-2.5">
      <span className="inline-flex items-center justify-center rounded-lg p-1.5 bg-emerald-500/10 text-emerald-400 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold text-white leading-tight tabular-nums">{value}</div>
        <div className="text-[10px] text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}

function Legend({ items }: { items: { c: string; t: string; dashed?: boolean; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="inline-block" style={
            it.dashed ? { width: 12, height: 0, borderTop: `2px dashed ${it.c}` }
            : it.line ? { width: 12, height: 0, borderTop: `2px solid ${it.c}` }
            : { width: 10, height: 10, borderRadius: 9999, background: it.c }
          } />
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
              <th key={i} className={`text-right font-semibold px-3 py-2 text-xs ${i === lastIdx ? 'text-sky-300 bg-sky-500/5' : ''}`}>
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
                <td key={i} className={`text-right px-3 py-2 tabular-nums ${i === lastIdx ? 'text-white font-semibold bg-sky-500/5' : 'text-slate-300'}`}>
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
