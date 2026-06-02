import { useMemo, useState } from 'react'
import { Construction, Banknote, Receipt, TrendingUp, Minus, Plus, Wallet, Info } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { useAnalytics, shiftPeriodo, MESES_ES } from '../hooks/useAnalytics'
import { defaultPeriodoMes, defaultPeriodoAnio } from '../lib/diagrama'
import {
  calcularSueldo, configFromSettings, isSalaryUser, fmtPesos, convenioLabel,
  type SalaryEstimate, type LineItem,
} from '../lib/calculo-salarial'

export function ProyeccionSalarialPage() {
  const { settings, loaded } = useSettings()

  // Defensa en profundidad: aunque la pestaña esté oculta en la nav, la página
  // sólo muestra contenido al usuario de prueba.
  if (loaded && !isSalaryUser(settings.nombreUsuario)) return <Oculta />
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

function Proyeccion() {
  const { settings } = useSettings()
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const { periodos, loading } = useAnalytics(mes, anio, 0)

  const est = useMemo<SalaryEstimate | null>(() => {
    if (!settings.sueldoBasico) return null
    const registros = periodos[0]?.registros ?? []
    return calcularSueldo(registros, configFromSettings(settings))
  }, [periodos, settings])

  function cambiarMes(delta: number) {
    const { mes: m, anio: a } = shiftPeriodo(mes, anio, delta)
    setMes(m); setAnio(a)
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      {/* Header con selector de mes */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
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
        <div className="text-center text-slate-500 py-16">Cargando…</div>
      ) : !settings.sueldoBasico ? (
        <SinBasico />
      ) : !est || est.diasTrabajados === 0 ? (
        <div className="px-6 py-16 text-center text-slate-500">
          <Banknote size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hay horas cargadas en este período.</p>
          <p className="text-xs text-slate-600 mt-1">Cargá horas para ver la estimación salarial.</p>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {/* Neto */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-900/40 to-slate-800/60 border border-emerald-800/40 p-4">
            <div className="text-xs text-emerald-300/80">Neto estimado · {MESES_ES[mes]} {anio}</div>
            <div className="text-4xl font-bold text-white leading-none mt-1">{fmtPesos(est.netoEstimado)}</div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <Mini label="Bruto" value={fmtPesos(est.bruto)} />
              <Mini label="Retenciones" value={`-${fmtPesos(est.retenciones)}`} accent="text-red-300" />
              <Mini label="Días trab." value={String(est.diasTrabajados)} />
            </div>
          </div>

          {/* Horas del período */}
          <div className="grid grid-cols-4 gap-2">
            <HoraChip label="50%" value={est.totalExtra50} accent="text-amber-300" />
            <HoraChip label="100%" value={est.totalExtra100} accent="text-orange-300" />
            <HoraChip label="Viaje" value={est.totalViaje} />
            <HoraChip label="Noct." value={est.totalNocturnas} />
          </div>

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

          {/* Resumen final */}
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
              Estimación. Los no remunerativos (viandas) y la retención de Ganancias varían según el mes;
              no se incluyen devoluciones/ajustes anuales de Ganancias ni adicionales personales.
            </p>
          </div>
        </div>
      )}
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
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-slate-400 truncate pr-2">{it.concepto}</span>
            <span className={`tabular-nums shrink-0 ${negative ? 'text-red-300/80' : 'text-slate-300'}`}>
              {negative ? '-' : ''}{fmtPesos(it.monto)}
            </span>
          </div>
        ))}
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
