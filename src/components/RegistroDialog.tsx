import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { X, CalendarDays, Clock } from 'lucide-react'
import type { RegistroHoras } from '../db/database'
import { esFeriadoNacional } from '../lib/feriados'
import { esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'

interface Props {
  fecha: Date
  existing?: RegistroHoras
  proyectosFrecuentes: string[]
  diagrama: DiagramaPatternKey
  diagramaInicioMs: number
  onSave: (reg: RegistroHoras) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

function timeToMs(base: Date, hhmm: string): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

function msToTime(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type LugarTrabajo = 'Base' | 'Campo' | 'Franco'
type Pernocte = 'NO' | 'Hotel' | 'Trailer'
/** Mutually-exclusive sub-states for "Comp/Feriado/Aus" days */
type SubFranco = 'COMP' | 'TRABAJADO' | 'FERIADO' | 'AUSENCIA' | null

function getInitialSubFranco(existing: RegistroHoras | undefined): SubFranco {
  // Handle both old format (lugarTrabajo='Franco') and new format (esFrancoTrabajado + lugar=Base/Campo)
  const isFrancoType = existing?.lugarTrabajo === 'Franco' || existing?.esFrancoTrabajado
  if (!existing || !isFrancoType) return null
  if (existing.esFrancoTrabajado) return 'TRABAJADO'
  if (existing.esFeriadoTrabajado) return 'TRABAJADO'
  if (existing.esFrancoCompensatorio) return 'COMP'
  if (existing.esAusenciaJustificada) return 'AUSENCIA'
  if (existing.esFeriado) return 'FERIADO'
  return null
}

export function RegistroDialog({ fecha, existing, proyectosFrecuentes, diagrama, diagramaInicioMs, onSave, onDelete, onClose }: Props) {
  const esFrancoHoy = esFrancoPorDiagrama(fecha.getTime(), diagrama, diagramaInicioMs)
  const esFeriadoHoy = esFeriadoNacional(fecha.getTime())

  // Show 'Franco' button for any franco-type record (including new format where lugarTrabajo=Base/Campo)
  const [lugar, setLugar] = useState<LugarTrabajo>(
    existing?.esFrancoTrabajado || existing?.esFrancoCompensatorio ||
    existing?.esAusenciaJustificada || existing?.lugarTrabajo === 'Franco'
      ? 'Franco'
      : existing?.lugarTrabajo ?? (esFrancoHoy ? 'Franco' : 'Base')
  )
  const [lugarFranco, setLugarFranco] = useState<'Base' | 'Campo'>(
    existing?.esFrancoTrabajado &&
    (existing.lugarTrabajo === 'Base' || existing.lugarTrabajo === 'Campo')
      ? existing.lugarTrabajo
      : 'Campo'
  )
  const [e1, setE1] = useState(msToTime(existing?.entradaInicioMs))
  const [s1, setS1] = useState(msToTime(existing?.salidaInicioMs))
  const [pernocte, setPernocte] = useState<Pernocte>(existing?.pernocte ?? 'NO')
  const [maneja, setManeja] = useState(existing?.maneja ?? false)
  const [horasViaje, setHorasViaje] = useState(String(existing?.horasViaje ?? ''))
  const [proyectoObs, setProyectoObs] = useState(
    existing?.proyecto && existing?.observaciones && existing.proyecto !== existing.observaciones
      ? `${existing.proyecto} - ${existing.observaciones}`
      : existing?.observaciones || existing?.proyecto || ''
  )
  const [esFeriadoTrabajado, setEsFeriadoTrabajado] = useState(existing?.esFeriadoTrabajado ?? false)
  const [subFranco, setSubFranco] = useState<SubFranco>(getInitialSubFranco(existing))

  // Franco + both Entrada AND Salida entered → auto-detected as "Franco Trabajado" (100%)
  const isFrancoWorked = lugar === 'Franco' && !!(e1 && s1)
  // Effective lugar: use lugarFranco when worked on franco day, otherwise 'Franco' for absences
  const efectiveLugar: 'Base' | 'Campo' | 'Franco' = isFrancoWorked ? lugarFranco : lugar
  // A day is "off" (no times saved) when Franco with no times entered
  const isDayOff = efectiveLugar === 'Franco'

  function handleSave() {
    // Auto-detect feriado trabajado for national holidays when times are entered
    const saveEsFeriadoTrabajado = esFeriadoHoy
      ? !!(e1 && s1) && !isDayOff
      : esFeriadoTrabajado

    const reg: RegistroHoras = {
      id: existing?.id ?? uuid(),
      fechaMs: fecha.getTime(),
      entradaInicioMs: isDayOff ? null : timeToMs(fecha, e1),
      salidaInicioMs: isDayOff ? null : timeToMs(fecha, s1),
      entradaFinMs: existing?.entradaFinMs ?? null,
      salidaFinMs: existing?.salidaFinMs ?? null,
      lugarTrabajo: efectiveLugar,
      pernocte: efectiveLugar === 'Base' ? 'NO' : pernocte,
      maneja: efectiveLugar === 'Base' ? false : maneja,
      horasViaje: efectiveLugar === 'Base' ? 0 : (parseFloat(horasViaje) || 0),
      observaciones: proyectoObs,
      proyecto: proyectoObs,
      esFeriado: esFeriadoHoy || saveEsFeriadoTrabajado || (!isFrancoWorked && lugar === 'Franco' && subFranco === 'FERIADO'),
      esFeriadoTrabajado: saveEsFeriadoTrabajado,
      esFrancoCompensatorio: !isFrancoWorked && subFranco === 'COMP',
      esFrancoTrabajado: isFrancoWorked,
      esAusenciaJustificada: !isFrancoWorked && subFranco === 'AUSENCIA',
      fechaCreacion: existing?.fechaCreacion ?? Date.now(),
    }
    onSave(reg)
  }

  const labelDia = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Editar Registro</p>
            <h2 className="text-lg font-bold text-white capitalize">{labelDia}</h2>
            {esFeriadoHoy && (
              <span className="text-xs text-amber-400 flex items-center gap-1 mt-0.5">
                <CalendarDays size={12} /> Feriado nacional
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2"><X size={20} /></button>
        </div>

        {/* ── Turno (times) ── always shown; on Franco days, entering times auto-marks as Trabajado */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Turno</p>
          <div className="grid grid-cols-2 gap-3">
            <TimeInput label="Entrada" value={e1} onChange={setE1} />
            <TimeInput label="Salida" value={s1} onChange={setS1} />
          </div>
        </div>

        {/* ── Lugar de Trabajo ── */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Lugar de Trabajo</p>
          <div className="flex gap-2">
            {(['Base', 'Campo'] as LugarTrabajo[]).map(l => (
              <button key={l} onClick={() => setLugar(l)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${lugar === l ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                {l}
              </button>
            ))}
            <button onClick={() => setLugar('Franco')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-colors ${lugar === 'Franco' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Comp/Feriado/Aus
            </button>
          </div>
        </div>

        {/* ── Sub-flags for Comp/Feriado/Aus — only when Franco and no times entered ── */}
        {lugar === 'Franco' && !isFrancoWorked && (
          <div className="bg-slate-700/40 rounded-xl p-3 mb-4">
            <p className="text-xs text-slate-400 mb-2">Tipo de ausencia</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['COMP', 'Compensatorio'],
                ['FERIADO', 'Feriado (ausencia)'],
                ['AUSENCIA', 'Ausencia Just.'],
              ] as [SubFranco, string][]).map(([key, label]) => (
                <button
                  key={key!}
                  onClick={() => setSubFranco(subFranco === key ? null : key)}
                  className={`py-2 rounded-lg text-xs font-medium text-center transition-colors ${subFranco === key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Lugar worked on franco day (Base or Campo) ── */}
        {isFrancoWorked && (
          <div className="bg-slate-700/40 rounded-xl p-3 mb-4">
            <p className="text-xs text-slate-400 mb-2">¿Trabajó en?</p>
            <div className="flex gap-2">
              {(['Campo', 'Base'] as const).map(l => (
                <button key={l} onClick={() => setLugarFranco(l)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${lugarFranco === l ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {l}
                </button>
              ))}
            </div>
            <p className="text-xs text-amber-400 mt-2">Franco trabajado — horas al 100%</p>
          </div>
        )}

        {/* ── Feriado (100%) toggle — for Base/Campo; auto-detected for national holidays ── */}
        {lugar !== 'Franco' && (
          <div className="mb-4">
            {esFeriadoHoy && e1 && s1 ? (
              <p className="text-xs text-amber-400 flex items-center gap-1">
                <CalendarDays size={12} /> Feriado nacional trabajado — horas al 100% (auto)
              </p>
            ) : (
              <Toggle label="Feriado (100%)" value={esFeriadoTrabajado} onChange={setEsFeriadoTrabajado} />
            )}
          </div>
        )}

        {/* ── Pernocte / Maneja / Horas viaje — Campo and Franco trabajado at Campo only ── */}
        {!isDayOff && efectiveLugar !== 'Base' && (
          <div className="space-y-3 mb-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Pernocte</p>
              <div className="flex gap-2">
                {(['NO', 'Hotel', 'Trailer'] as Pernocte[]).map(p => (
                  <button key={p} onClick={() => setPernocte(p)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium ${pernocte === p ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Toggle label="Manejó este día" value={maneja} onChange={setManeja} />
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-300 flex-1">Horas de viaje</label>
              <input type="number" min="0" max="24" step="0.5"
                value={horasViaje} onChange={e => setHorasViaje(e.target.value)}
                className="w-20 bg-slate-700 text-white rounded-lg px-2 py-1.5 text-sm text-center" />
            </div>
          </div>
        )}

        {/* ── Proyecto / Observaciones ── */}
        <div className="mb-5">
          <label className="text-xs text-slate-400 mb-1 block">Proyecto / Observaciones</label>
          <ProjectInput value={proyectoObs} onChange={setProyectoObs} suggestions={proyectosFrecuentes} />
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-2">
          {existing && onDelete && (
            <button onClick={() => { onDelete(existing.id); onClose() }}
              className="px-4 py-3 rounded-xl bg-red-600/20 text-red-400 text-sm font-medium">
              Eliminar
            </button>
          )}
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium">Cancelar</button>
          <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold">Guardar</button>
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-300">{label}</span>
      <button onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full transition-colors relative ${value ? 'bg-blue-600' : 'bg-slate-600'}`}>
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-7' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1">
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      <div className="relative">
        <input
          type="time"
          step="900"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-slate-700 text-white rounded-xl px-4 py-3 text-base font-mono
                     [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
        />
        <Clock size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
      </div>
    </div>
  )
}

function ProjectInput({ value, onChange, suggestions }: { value: string; onChange: (v: string) => void; suggestions: string[] }) {
  const [open, setOpen] = useState(false)
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()))

  return (
    <div className="relative">
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm" />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-slate-700 rounded-xl overflow-hidden shadow-xl">
          {filtered.map(s => (
            <button key={s} onMouseDown={() => { onChange(s); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-600">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
