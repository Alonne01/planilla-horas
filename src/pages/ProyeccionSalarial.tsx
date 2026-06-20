import { useMemo, useState } from 'react'
import {
  Construction, Banknote, Receipt, TrendingUp, Minus, Plus, Wallet, Info,
  LayoutGrid, BarChart3, ListTree, CalendarRange,
} from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { useAnalytics, shiftPeriodo, MESES_ES, type PeriodoStats } from '../hooks/useAnalytics'
import {
  defaultPeriodoMes, defaultPeriodoAnio, periodoStart, periodoEnd, DIAGRAMAS,
} from '../lib/diagrama'
import { calcularHorasDia } from '../lib/calculo-horas'
import {
  calcularSueldo, configFromSettings, isSalaryUser, salarioDesbloqueadoNube, fmtPesos, convenioLabel, proyectarNeto,
  type SalaryEstimate, type LineItem,
} from '../lib/calculo-salarial'
import { basicoProyectado } from '../lib/paritarias'
import {
  TendenciaNetoChart, TendenciaAcumuladaChart, ComposicionCard, GananciaDiaCard, MiniDonut, KpiGrid,
  ProyeccionCard, DeltaBadge, useCountUp,
} from '../components/SalaryCharts'

export function ProyeccionSalarialPage() {
  const { settings, loaded } = useSettings()
  // Defensa en profundidad: aunque la pestaña esté oculta en la nav, sólo muestra contenido al tester
  // (whitelist) o a quien el admin haya habilitado desde la nube (salarioDesbloqueadoNube).
  if (loaded && !isSalaryUser(settings.nombreUsuario) && !salarioDesbloqueadoNube()) return <Oculta />
  return <Proyeccion />
}

function Oculta() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <div className="flex justify-center text-slate-500"><Construction size={48} /></div>
        <h1 className="text-xl font-bold text-white">Proyección Salarial</h1>
        <p className="text-slate-400 text-sm max-w-xs">
          Esta función está disponible pero temporalmente oculta.
          Se habilitará una vez esté configurada para todos los convenios.
        </p>
      </div>
    </div>
  )
}

type Tab = 'resumen' | 'analisis' | 'desglose'

function Proyeccion() {
  const { settings } = useSettings()
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const [tab, setTab] = useState<Tab>('resumen')
  const { periodos, loading } = useAnalytics(mes, anio, 5, settings.lineaTrabajo)

  const actual = periodos[periodos.length - 1] as PeriodoStats | undefined

  // Estimación del período actual.
  const est = useMemo<SalaryEstimate | null>(() => {
    if (!settings.sueldoBasico || !actual) return null
    const basicoMes = basicoProyectado(settings.convenio, anio, mes, settings.sueldoBasico, settings.sueldoBasicoVigenciaMs)
    return calcularSueldo(actual.registros, { ...configFromSettings(settings), sueldoBasico: basicoMes })
  }, [actual, settings, mes, anio])

  // Serie histórica del neto mes a mes (omite meses sin días trabajados).
  const serieNeto = useMemo(() => {
    return periodos
      .filter(p => p.diasTrabajados > 0)
      .map(p => {
        const basicoMes = basicoProyectado(settings.convenio, p.anio, p.mes, settings.sueldoBasico, settings.sueldoBasicoVigenciaMs)
        const e = calcularSueldo(p.registros, { ...configFromSettings(settings), sueldoBasico: basicoMes })
        return { label: p.label, neto: e.netoEstimado }
      })
  }, [periodos, settings])

  function cambiarMes(delta: number) {
    const { mes: m, anio: a } = shiftPeriodo(mes, anio, delta)
    setMes(m); setAnio(a)
  }

  const sinDatos = !est || est.diasTrabajados === 0

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      {/* Header con selector de mes */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => cambiarMes(-1)} className="p-2 text-slate-400 active:text-white">‹</button>
          <div className="text-center">
            <div className="text-base font-bold text-white flex items-center gap-1.5 justify-center">
              <Banknote size={16} className="text-emerald-400" /> Proyección Salarial
            </div>
            <div className="text-xs text-slate-500">{MESES_ES[mes]} {anio} · {convenioLabel(settings.convenio)}</div>
          </div>
          <button onClick={() => cambiarMes(1)} className="p-2 text-slate-400 active:text-white">›</button>
        </div>
      </div>

      {loading ? (
        <div className="px-4 space-y-4 py-4">
          <div className="h-32 rounded-2xl bg-slate-800/60 animate-pulse" />
          <div className="h-40 rounded-2xl bg-slate-800/60 animate-pulse" style={{ animationDelay: '120ms' }} />
        </div>
      ) : !settings.sueldoBasico ? (
        <SinBasico />
      ) : sinDatos ? (
        <div className="px-6 py-16 text-center text-slate-500">
          <Banknote size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hay horas cargadas en este período.</p>
          <p className="text-xs text-slate-600 mt-1">Cargá horas para ver la estimación salarial.</p>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {/* Hero del neto — siempre visible */}
          <HeroNeto est={est!} mes={mes} anio={anio} hsActivas={actual!.total} />

          {/* Pestañas */}
          <div className="sticky top-[52px] z-10 -mx-4 px-4 py-2 bg-slate-900/95 backdrop-blur">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-800/70 border border-slate-700/50 p-1">
              <TabBtn active={tab === 'resumen'} onClick={() => setTab('resumen')} icon={<LayoutGrid size={14} />} label="Resumen" />
              <TabBtn active={tab === 'analisis'} onClick={() => setTab('analisis')} icon={<BarChart3 size={14} />} label="Análisis" />
              <TabBtn active={tab === 'desglose'} onClick={() => setTab('desglose')} icon={<ListTree size={14} />} label="Desglose" />
            </div>
          </div>

          {tab === 'resumen' && <TabResumen est={est!} actual={actual!} settings={settings} mes={mes} anio={anio} />}
          {tab === 'analisis' && <TabAnalisis est={est!} actual={actual!} settings={settings} serieNeto={serieNeto} mes={mes} anio={anio} />}
          {tab === 'desglose' && <TabDesglose est={est!} />}
        </div>
      )}
    </div>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────────
function HeroNeto({ est, mes, anio, hsActivas }: { est: SalaryEstimate; mes: number; anio: number; hsActivas: number }) {
  const netoAnim = useCountUp(est.netoEstimado)
  const vhProm = hsActivas > 0 ? est.netoEstimado / hsActivas : 0
  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-900/50 to-slate-800/60 border border-emerald-800/40 p-5">
      <div className="text-xs text-emerald-300/80 tracking-wide">NETO ESTIMADO · {MESES_ES[mes]} {anio}</div>
      <div className="text-4xl font-bold text-white leading-none mt-1 tabular-nums">{fmtPesos(Math.round(netoAnim))}</div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        <Mini label="Bruto" value={fmtPesos(est.bruto)} />
        <Mini label="Valor hora" value={fmtPesos(vhProm)} />
        <Mini label="Hs activas" value={`${hsActivas.toFixed(1)}`} />
      </div>
    </div>
  )
}

// ─── Tab: Resumen ───────────────────────────────────────────────────────────────
function TabResumen({ est, actual, settings, mes, anio }: {
  est: SalaryEstimate; actual: PeriodoStats; settings: any; mes: number; anio: number
}) {
  const proy = useMemo(() => calcularProyeccion(est, settings, mes, anio), [est, settings, mes, anio])
  const totalDiasOp = est.diasBase + est.diasCampo
  const campoPct = totalDiasOp > 0 ? (est.diasCampo / totalDiasOp) * 100 : 0
  const extraPct = actual.total > 0 ? (actual.extra / actual.total) * 100 : 0
  const ingresoDia = est.diasTrabajados > 0 ? est.netoEstimado / est.diasTrabajados : 0
  const variablesCampo = est.diasTrabajados > 0 ? est.subtotalVariables * (est.diasCampo / est.diasTrabajados) : 0

  return (
    <div className="space-y-4">
      {proy && (
        <ProyeccionCard pct={proy.pct} diasTxt={proy.diasTxt} neto={est.netoEstimado} proyectado={proy.proyectado} />
      )}

      <KpiGrid items={[
        { label: '$/Hora prom.', value: fmtPesos(actual.total > 0 ? est.netoEstimado / actual.total : 0) },
        { label: '$/Día trabajado', value: fmtPesos(ingresoDia) },
        { label: '% Horas extras', value: `${extraPct.toFixed(0)}%`, accent: 'text-amber-300' },
        { label: 'Variables campo', value: fmtPesos(variablesCampo), accent: 'text-emerald-300' },
      ]} />

      <Card title="Distribución operativa" icon={<CalendarRange size={15} className="text-emerald-400" />}>
        <div className="grid grid-cols-2 gap-2">
          <MiniDonut pct={campoPct} label="Días campo" sub={`${est.diasCampo}/${totalDiasOp}`} color="#34d399" />
          <MiniDonut pct={extraPct} label="Horas extras" sub={`${extraPct.toFixed(0)}%`} color="#fb923c" />
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          <HoraChip label="50%" value={est.totalExtra50} accent="text-amber-300" />
          <HoraChip label="100%" value={est.totalExtra100} accent="text-orange-300" />
          <HoraChip label="Viaje" value={est.totalViaje} />
          <HoraChip label="Noct." value={est.totalNocturnas} />
        </div>
      </Card>
    </div>
  )
}

// ─── Tab: Análisis ──────────────────────────────────────────────────────────────
function TabAnalisis({ est, actual, settings, serieNeto, mes, anio }: {
  est: SalaryEstimate; actual: PeriodoStats; settings: any; serieNeto: { label: string; neto: number }[]; mes: number; anio: number
}) {
  const hb = est.horaBase
  // Días trabajados ordenados (compartidos por la ganancia/día y el acumulado).
  const diasOrd = useMemo(() => actual.registros
    .map(reg => ({ reg, h: calcularHorasDia(reg, settings.lineaTrabajo) }))
    .filter(x => x.h.horasTrabajadas > 0)
    .sort((a, b) => a.reg.fechaMs - b.reg.fechaMs), [actual, settings])

  const diasData = useMemo(() => diasOrd.map(({ reg, h }) => ({
    dia: String(new Date(reg.fechaMs).getDate()),
    normal: h.horasNormales * hb,
    extra: h.horasAl50 * hb * 1.5 + h.horasAl100 * hb * 2,
  })), [diasOrd, hb])

  // Acumulado del NETO por día: escala la curva de valor-de-horas para que cierre en el neto actual.
  const acumData = useMemo(() => {
    const valorTotal = diasOrd.reduce((s, { h }) => s + h.horasNormales * hb + h.horasAl50 * hb * 1.5 + h.horasAl100 * hb * 2, 0)
    const factor = valorTotal > 0 ? est.netoEstimado / valorTotal : 0
    let acc = 0
    return diasOrd.map(({ reg, h }) => {
      acc += h.horasNormales * hb + h.horasAl50 * hb * 1.5 + h.horasAl100 * hb * 2
      return { label: String(new Date(reg.fechaMs).getDate()), real: acc * factor }
    })
  }, [diasOrd, hb, est.netoEstimado])

  const proyectado = useMemo(() => calcularProyeccion(est, settings, mes, anio)?.proyectado ?? null, [est, settings, mes, anio])

  const cur = serieNeto[serieNeto.length - 1]?.neto ?? est.netoEstimado
  const prev = serieNeto[serieNeto.length - 2]?.neto ?? 0

  return (
    <div className="space-y-4">
      <Card title="Tendencia del neto" icon={<TrendingUp size={15} className="text-emerald-400" />}
        action={<DeltaBadge cur={cur} prev={prev} />}>
        <TendenciaNetoChart data={serieNeto} />
      </Card>

      {acumData.length >= 2 && (
        <Card title="Cobrado acumulado del período" icon={<TrendingUp size={15} className="text-emerald-400" />}>
          <TendenciaAcumuladaChart data={acumData} proyectado={proyectado} />
        </Card>
      )}

      <Card title="Composición del bruto" icon={<Wallet size={15} className="text-sky-400" />}>
        <ComposicionCard
          fijos={est.subtotalFijos} variables={est.subtotalVariables} noRem={est.subtotalNoRemunerativo}
          retenciones={est.retenciones} bruto={est.bruto} neto={est.netoEstimado} />
      </Card>

      {diasData.length > 0 && (
        <Card title="Ganancia estimada por día" icon={<BarChart3 size={15} className="text-amber-400" />}>
          <GananciaDiaCard data={diasData} />
        </Card>
      )}
    </div>
  )
}

// ─── Tab: Desglose ──────────────────────────────────────────────────────────────
function TabDesglose({ est }: { est: SalaryEstimate }) {
  return (
    <div className="space-y-4">
      <LineSection title="Remunerativo fijo" icon={<Wallet size={15} className="text-sky-400" />}
        items={est.fijoItems} subtotal={est.subtotalFijos} />
      {est.variableItems.length > 0 && (
        <LineSection title="Remunerativo variable" icon={<TrendingUp size={15} className="text-amber-400" />}
          items={est.variableItems} subtotal={est.subtotalVariables} />
      )}
      <LineSection title="No remunerativo" icon={<Plus size={15} className="text-emerald-400" />}
        items={est.noRemItems} subtotal={est.subtotalNoRemunerativo} />
      <LineSection title="Retenciones" icon={<Minus size={15} className="text-red-400" />}
        items={est.retencionItems} subtotal={est.retenciones} negative />

      <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4 space-y-1.5">
        <Row label="Bruto" value={fmtPesos(est.bruto)} />
        <Row label="Retenciones" value={`-${fmtPesos(est.retenciones)}`} accent="text-red-300" />
        <div className="border-t border-slate-700/50 my-1" />
        <Row label="Neto estimado" value={fmtPesos(est.netoEstimado)} bold />
        <p className="text-[11px] text-slate-500 pt-1">
          Base imponible: {fmtPesos(est.baseImponibleRaw)}
          {est.baseImponibleCapped < est.baseImponibleRaw && ` · topeada a ${fmtPesos(est.baseImponibleCapped)}`}
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-800/40 border border-slate-700/40 px-3 py-2.5">
        <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Estimación. Ganancias y la vianda complementaria IG son estimadas (calibradas a recibos;
          RRHH liquida el valor exacto). No incluye devoluciones/ajustes anuales de Ganancias, SAC
          ni adicionales personales; las viandas son un conteo aproximado.
        </p>
      </div>
    </div>
  )
}

/** Proyección fin de período: usa el diagrama para estimar los días de trabajo restantes. */
function calcularProyeccion(est: SalaryEstimate, settings: any, mes: number, anio: number) {
  const start = periodoStart(mes, anio)
  const end = periodoEnd(mes, anio)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const esActual = today >= start && today <= end
  if (!esActual || est.diasTrabajados === 0) return null

  const DAY = 86_400_000
  const totalDias = Math.round((end.getTime() - start.getTime()) / DAY) + 1
  const transcurridos = Math.min(totalDias, Math.round((today.getTime() - start.getTime()) / DAY) + 1)
  const restantes = Math.max(0, totalDias - transcurridos)
  const diag = DIAGRAMAS.find(d => d.key === settings.diagrama) ?? DIAGRAMAS[0]
  const ratioTrabajo = diag.diasTrabajo / (diag.diasTrabajo + diag.diasFranco)
  const diasTrabRestantes = Math.round(restantes * ratioTrabajo)
  const proyectado = proyectarNeto(est, est.diasTrabajados + diasTrabRestantes)
  return {
    pct: transcurridos / totalDias,
    diasTxt: `${transcurridos} de ${totalDias} días · ~${diasTrabRestantes} de trabajo restantes`,
    proyectado,
  }
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
        active ? 'bg-emerald-600 text-white' : 'text-slate-400 active:text-white'}`}>
      {icon}{label}
    </button>
  )
}

function Card({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">{icon}<h3 className="text-sm font-semibold text-slate-200">{title}</h3></div>
        {action}
      </div>
      {children}
    </div>
  )
}

function SinBasico() {
  return (
    <div className="px-6 py-16 text-center text-slate-500">
      <Receipt size={40} className="mx-auto mb-3 opacity-40" />
      <p className="text-sm">Falta configurar el sueldo básico.</p>
      <p className="text-xs text-slate-600 mt-1">Cargá tu convenio y básico en Configuración → Salario.</p>
    </div>
  )
}

function LineSection({ title, icon, items, subtotal, negative }: {
  title: string; icon: React.ReactNode; items: LineItem[]; subtotal: number; negative?: boolean
}) {
  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        </div>
        <span className={`text-sm font-bold ${negative ? 'text-red-300' : 'text-slate-200'}`}>
          {negative ? '-' : ''}{fmtPesos(subtotal)}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((it, i) => {
          const esDescuento = it.monto < 0
          return (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-400 truncate pr-2">{it.concepto}</span>
              <span className={`tabular-nums shrink-0 ${negative || esDescuento ? 'text-red-300/80' : 'text-slate-300'}`}>
                {esDescuento ? `-${fmtPesos(Math.abs(it.monto))}` : `${negative ? '-' : ''}${fmtPesos(it.monto)}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Mini({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700/50 px-2.5 py-2">
      <div className={`text-sm font-bold ${accent}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  )
}

function HoraChip({ label, value, accent = 'text-white' }: { label: string; value: number; accent?: string }) {
  const v = Math.round(value * 10) / 10
  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-2 py-2 text-center">
      <div className={`text-base font-bold ${accent}`}>{v}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  )
}

function Row({ label, value, accent = 'text-white', bold }: { label: string; value: string; accent?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? 'text-white font-semibold' : 'text-slate-400'}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-lg font-bold ' + accent : 'text-sm ' + accent}`}>{value}</span>
    </div>
  )
}
