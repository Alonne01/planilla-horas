import type { RegistroHoras } from '../db/database'
import { calcularHorasDia, esDiaNoTrabajado } from '../lib/calculo-horas'
import { esFeriadoNacional } from '../lib/feriados'
import { Palmtree, Banknote, CalendarDays, HeartPulse } from 'lucide-react'

interface Props {
  fecha: Date
  registro?: RegistroHoras
  onClick: () => void
}

const DIAS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function fmt2(n: number) { return String(n).padStart(2, '0') }

function timeStr(ms: number | null | undefined): string {
  if (!ms) return '--:--'
  const d = new Date(ms)
  return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`
}

function lugarColor(lugar: string): string {
  switch (lugar) {
    case 'Campo': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    case 'Base': return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    case 'Franco': return 'bg-slate-600/30 text-slate-400 border-slate-600/30'
    default: return 'bg-slate-700/30 text-slate-400 border-slate-600/30'
  }
}

export function DayCard({ fecha, registro, onClick }: Props) {
  const dow = fecha.getDay()
  const isWeekend = dow === 0 || dow === 6
  const isFeriadoNacional = esFeriadoNacional(fecha.getTime())
  const isEmpty = !registro

  let label = ''
  let badgeIcon: React.ReactNode = null
  let horasStr = ''
  let subtipo = ''

  if (!isEmpty) {
    const h = calcularHorasDia(registro!)
    const isDayOff = esDiaNoTrabajado(registro!)

    if (registro!.esFrancoCompensatorio) { label = 'Franco Comp.'; badgeIcon = <Palmtree size={13} /> }
    else if (registro!.esFrancoTrabajado) { label = 'Franco Trab.'; badgeIcon = <Banknote size={13} /> }
    else if (registro!.esFeriadoTrabajado) { label = 'Feriado Trab.'; badgeIcon = <Banknote size={13} /> }
    else if (registro!.esFeriado && isDayOff) { label = 'Feriado'; badgeIcon = <CalendarDays size={13} /> }
    else if (registro!.esAusenciaJustificada) { label = 'Ausencia'; badgeIcon = <HeartPulse size={13} /> }
    else if (isDayOff) { label = 'Franco' }
    else { label = registro!.lugarTrabajo }

    if (!isDayOff && h.horasTrabajadas > 0) {
      horasStr = h.horasTrabajadas.toFixed(1) + ' hs'
      const extras = []
      if (h.horasAl50 > 0) extras.push(`${h.horasAl50.toFixed(1)} al 50%`)
      if (h.horasAl100 > 0) extras.push(`${h.horasAl100.toFixed(1)} al 100%`)
      if (extras.length) subtipo = extras.join(' · ')
    }
  }

  const borderColor = isEmpty
    ? (isWeekend || isFeriadoNacional ? 'border-slate-700' : 'border-slate-600/50')
    : registro!.lugarTrabajo === 'Campo' ? 'border-emerald-600/40'
    : registro!.lugarTrabajo === 'Base' ? 'border-blue-600/40'
    : 'border-slate-600/30'

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border ${borderColor} 
        ${isEmpty && !isWeekend ? 'bg-slate-800/30' : 'bg-slate-800/60'} 
        active:scale-[0.98] transition-transform text-left`}
    >
      {/* Day number */}
      <div className="w-10 flex-shrink-0 text-center">
        <div className={`text-xs ${isWeekend || isFeriadoNacional ? 'text-amber-400' : 'text-slate-500'}`}>
          {DIAS_SHORT[dow]}
        </div>
        <div className={`text-lg font-bold leading-tight ${isEmpty ? 'text-slate-500' : 'text-white'}`}>
          {fmt2(fecha.getDate())}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEmpty ? (
          <span className="text-slate-600 text-sm">
            {isWeekend ? 'Franco' : isFeriadoNacional ? 'Feriado' : 'Sin registro'}
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              {badgeIcon && <span className="text-slate-300">{badgeIcon}</span>}
              <span className="text-sm font-medium text-white">{label}</span>
              {!esDiaNoTrabajado(registro!) && registro!.lugarTrabajo !== 'Franco' && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${lugarColor(registro!.lugarTrabajo)}`}>
                  {registro!.lugarTrabajo}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex gap-2 flex-wrap">
              {!esDiaNoTrabajado(registro!) && registro!.entradaInicioMs && (
                <span>{timeStr(registro!.entradaInicioMs)} – {timeStr(registro!.salidaInicioMs)}</span>
              )}
              {registro!.entradaFinMs && (
                <span>{timeStr(registro!.entradaFinMs)} – {timeStr(registro!.salidaFinMs)}</span>
              )}
              {registro!.proyecto && <span className="text-blue-400">{registro!.proyecto}</span>}
              {registro!.observaciones && <span className="truncate max-w-[120px]">{registro!.observaciones}</span>}
            </div>
          </>
        )}
      </div>

      {/* Hours badge */}
      {horasStr && (
        <div className="flex-shrink-0 text-right">
          <div className="text-sm font-bold text-white">{horasStr}</div>
          {subtipo && <div className="text-xs text-slate-400">{subtipo}</div>}
        </div>
      )}

      {/* Empty tap indicator */}
      {isEmpty && (
        <div className="flex-shrink-0 text-slate-700">+</div>
      )}
    </button>
  )
}
