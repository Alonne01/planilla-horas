import { useState } from 'react'
import { v4 as uuid } from 'uuid'
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

export function RegistroDialog({ fecha, existing, proyectosFrecuentes, diagrama, diagramaInicioMs, onSave, onDelete, onClose }: Props) {
  const esFrancoHoy = esFrancoPorDiagrama(fecha.getTime(), diagrama, diagramaInicioMs)
  const esFeriadoHoy = esFeriadoNacional(fecha.getTime())

  const [lugar, setLugar] = useState<LugarTrabajo>(existing?.lugarTrabajo ?? (esFrancoHoy ? 'Franco' : 'Base'))
  const [e1, setE1] = useState(msToTime(existing?.entradaInicioMs))
  const [s1, setS1] = useState(msToTime(existing?.salidaInicioMs))
  const [e2, setE2] = useState(msToTime(existing?.entradaFinMs))
  const [s2, setS2] = useState(msToTime(existing?.salidaFinMs))
  const [pernocte, setPernocte] = useState<Pernocte>(existing?.pernocte ?? 'NO')
  const [maneja, setManeja] = useState(existing?.maneja ?? false)
  const [horasViaje, setHorasViaje] = useState(String(existing?.horasViaje ?? ''))
  const [obs, setObs] = useState(existing?.observaciones ?? '')
  const [proyecto, setProyecto] = useState(existing?.proyecto ?? '')
  const [esFeriado, setEsFeriado] = useState(existing?.esFeriado ?? esFeriadoHoy)
  const [esFeriadoTrabajado, setEsFeriadoTrabajado] = useState(existing?.esFeriadoTrabajado ?? false)
  const [esFrancoTrabajado, setEsFrancoTrabajado] = useState(existing?.esFrancoTrabajado ?? false)
  const [esFrancoComp, setEsFrancoComp] = useState(existing?.esFrancoCompensatorio ?? false)
  const [esAusencia, setEsAusencia] = useState(existing?.esAusenciaJustificada ?? false)

  const isDayOff = lugar === 'Franco' && !esFrancoTrabajado && !esFeriadoTrabajado

  function handleSave() {
    const reg: RegistroHoras = {
      id: existing?.id ?? uuid(),
      fechaMs: fecha.getTime(),
      entradaInicioMs: isDayOff ? null : timeToMs(fecha, e1),
      salidaInicioMs: isDayOff ? null : timeToMs(fecha, s1),
      entradaFinMs: isDayOff ? null : (e2 ? timeToMs(fecha, e2) : null),
      salidaFinMs: isDayOff ? null : (s2 ? timeToMs(fecha, s2) : null),
      lugarTrabajo: lugar,
      pernocte,
      maneja,
      horasViaje: parseFloat(horasViaje) || 0,
      observaciones: obs,
      proyecto,
      esFeriado: esFeriado || esFeriadoTrabajado,
      esFeriadoTrabajado,
      esFrancoCompensatorio: esFrancoComp,
      esFrancoTrabajado,
      esAusenciaJustificada: esAusencia,
      fechaCreacion: existing?.fechaCreacion ?? Date.now(),
    }
    onSave(reg)
  }

  const labelDia = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl p-4 pb-8 sm:pb-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white capitalize">{labelDia}</h2>
            {(esFeriadoHoy && !existing) && (
              <span className="text-xs text-amber-400">📅 Feriado nacional</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">✕</button>
        </div>

        {/* Lugar de trabajo */}
        <label className="block text-xs text-slate-400 mb-1">Lugar de trabajo</label>
        <div className="flex gap-2 mb-4">
          {(['Base', 'Campo', 'Franco'] as LugarTrabajo[]).map(l => (
            <button
              key={l}
              onClick={() => setLugar(l)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${lugar === l ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
            >{l}</button>
          ))}
        </div>

        {/* Franco sub-flags */}
        {lugar === 'Franco' && (
          <div className="bg-slate-700/50 rounded-xl p-3 mb-4 space-y-2">
            <Toggle label="Franco Compensatorio" value={esFrancoComp} onChange={v => { setEsFrancoComp(v); if (v) { setEsFrancoTrabajado(false); setEsAusencia(false) } }} />
            <Toggle label="Franco Trabajado (paga 100%)" value={esFrancoTrabajado} onChange={v => { setEsFrancoTrabajado(v); if (v) { setEsFrancoComp(false); setEsAusencia(false) } }} />
            <Toggle label="Ausencia Justificada (no paga)" value={esAusencia} onChange={v => { setEsAusencia(v); if (v) { setEsFrancoComp(false); setEsFrancoTrabajado(false) } }} />
            <Toggle label="Feriado (ausencia justificada)" value={esFeriado && !esFeriadoTrabajado} onChange={v => { setEsFeriado(v); if (v) setEsFeriadoTrabajado(false) }} />
          </div>
        )}

        {/* Feriado trabajado (any location) */}
        {lugar !== 'Franco' && (
          <div className="mb-4">
            <Toggle label="Feriado trabajado (paga 100%)" value={esFeriadoTrabajado} onChange={v => { setEsFeriadoTrabajado(v); setEsFeriado(v) }} />
          </div>
        )}

        {/* Times (hide for day-off) */}
        {!isDayOff && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <TimeInput label="Entrada" value={e1} onChange={setE1} />
              <TimeInput label="Salida" value={s1} onChange={setS1} />
            </div>
            <p className="text-xs text-slate-500 mb-2">2° turno (opcional)</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <TimeInput label="Entrada 2" value={e2} onChange={setE2} />
              <TimeInput label="Salida 2" value={s2} onChange={setS2} />
            </div>
          </>
        )}

        {/* Extra */}
        <div className="space-y-3 mb-4">
          {!isDayOff && (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-300">Pernocte</label>
                <div className="flex gap-2">
                  {(['NO', 'Hotel', 'Trailer'] as Pernocte[]).map(p => (
                    <button key={p} onClick={() => setPernocte(p)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium ${pernocte === p ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{p}</button>
                  ))}
                </div>
              </div>
              <Toggle label="Maneja" value={maneja} onChange={setManeja} />
              <div className="flex items-center gap-3">
                <label className="text-sm text-slate-300 flex-1">Horas de viaje</label>
                <input type="number" min="0" max="24" step="0.5"
                  value={horasViaje} onChange={e => setHorasViaje(e.target.value)}
                  className="w-20 bg-slate-700 text-white rounded-lg px-2 py-1 text-sm text-center" />
              </div>
            </>
          )}

          {/* Proyecto */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Proyecto</label>
            <ProjectInput value={proyecto} onChange={setProyecto} suggestions={proyectosFrecuentes} />
          </div>

          {/* Observaciones */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Observaciones</label>
            <textarea rows={2} value={obs} onChange={e => setObs(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm resize-none" />
          </div>
        </div>

        {/* Actions */}
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
    <div>
      <label className="text-xs text-slate-400 mb-1 block">{label}</label>
      <input type="time" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm" />
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
