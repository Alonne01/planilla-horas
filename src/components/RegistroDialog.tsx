import { useState, useEffect, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import { X, CalendarDays, Clock, Moon, Palmtree, Check } from 'lucide-react'
import { TimeDrumPicker } from './TimeDrumPicker'
import type { RegistroHoras } from '../db/database'
import { esFeriadoNacional, nombreFeriado } from '../lib/feriados'
import { esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'
import { turnoCruzaMedianoche } from '../lib/calculo-horas'

interface Props {
  fecha: Date
  existing?: RegistroHoras
  prevDayRegistro?: RegistroHoras
  lastWorkedRegistro?: RegistroHoras
  proyectosFrecuentes: string[]
  diagrama: DiagramaPatternKey
  diagramaInicioMs: number
  /** Francos compensatorios disponibles ANTES de guardar este registro */
  francosDisponibles: number
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

/** ¿La salida (HH:MM) tiene hora menor que la entrada? → el turno cruza la medianoche. */
function cruzaMedianocheStr(entrada: string, salida: string): boolean {
  if (!entrada || !salida) return false
  const [eh, em] = entrada.split(':').map(Number)
  const [sh, sm] = salida.split(':').map(Number)
  return sh * 60 + sm < eh * 60 + em
}

/**
 * Clasifica un turno (entrada/salida en "HH:MM") como noche o día para la nota
 * estética. Es noche si cruza la medianoche o si la mitad o más de sus horas caen
 * en la ventana nocturna 21:00–06:00 (mismo criterio que el cálculo salarial 644).
 */
function clasificarTurno(entrada: string, salida: string): 'noche' | 'dia' | null {
  if (!entrada || !salida) return null
  const [eh, em] = entrada.split(':').map(Number)
  const [sh, sm] = salida.split(':').map(Number)
  if ([eh, em, sh, sm].some(n => Number.isNaN(n))) return null
  const start = eh + em / 60
  let end = sh + sm / 60
  const cruza = end < start
  if (cruza) end += 24
  const total = end - start
  if (total <= 0) return null
  let noct = Math.max(0, Math.min(end, 30) - Math.max(start, 21))
  noct += Math.max(0, Math.min(end, 6) - Math.max(start, 0))
  return cruza || noct >= total / 2 ? 'noche' : 'dia'
}

type LugarTrabajo = 'Base' | 'Campo' | 'Franco'  // 'Franco' used only for saving absences
type Pernocte = 'NO' | 'Hotel' | 'Trailer'
// Viaje por slider: 100→350 km de a 50; 1,5 h por cada 100 km. El máximo (350) habilita hora manual.
const KM_MIN = 100, KM_MAX = 350, KM_STEP = 50
const STEPS = [0, 100, 150, 200, 250, 300, 350] // posiciones del slider de viaje (0 = sin viaje)
const horasPorKm = (km: number) => (km / 100) * 1.5
function fmtHorasViaje(h: number): string {
  const s = Number.isInteger(h) ? String(h) : String(h).replace('.', ',')
  return `${s} h`
}
function kmDesdeHoras(hv: number): number {
  const km = Math.round((hv / 1.5) * 100)
  return km >= KM_MIN && km < KM_MAX && (km - KM_MIN) % KM_STEP === 0 ? km : KM_MAX
}
/** Mutually-exclusive absence labels — shown only when no times entered */
type SubFranco = 'COMP' | 'AUSENCIA' | 'FALTA' | null

function getInitialSubFranco(existing: RegistroHoras | undefined): SubFranco {
  if (!existing) return null
  if (existing.esFrancoCompensatorio) return 'COMP'
  if (existing.esAusenciaJustificada) return 'AUSENCIA'
  if (existing.esFaltaInjustificada) return 'FALTA'
  return null
}

export function RegistroDialog({ fecha, existing, prevDayRegistro, lastWorkedRegistro, proyectosFrecuentes, diagrama, diagramaInicioMs, francosDisponibles, onSave, onDelete, onClose }: Props) {
  const esFrancoHoy = esFrancoPorDiagrama(fecha.getTime(), diagrama, diagramaInicioMs)
  const esFeriadoHoy = esFeriadoNacional(fecha.getTime())
  const nombreFeriadoHoy = nombreFeriado(fecha.getTime())

  // Actual work location — only 'Base' or 'Campo'; 'Franco' is stored for absences but never a button
  // Legacy franco-trabajado records have lugarTrabajo='Franco' → default to 'Campo'
  const [lugar, setLugar] = useState<'Base' | 'Campo'>(
    existing?.lugarTrabajo === 'Base' ? 'Base'
    : existing?.lugarTrabajo === 'Campo' ? 'Campo'
    : 'Campo'  // legacy 'Franco' worked records: campo is the safe default (no lunch deduction)
  )
  const [e1, setE1] = useState(msToTime(existing?.entradaInicioMs))
  const [s1, setS1] = useState(msToTime(existing?.salidaInicioMs))
  const [pernocte, setPernocte] = useState<Pernocte>(existing?.pernocte ?? 'NO')
  // Viaje. Campo: slider 0→350 (0 = sin viaje), 1,5 h c/100 km; el máximo habilita hora manual.
  // Base: toggle +1 h fija (viajeActivo). km/horas se derivan de horasViaje al editar.
  const hvExisting = existing?.horasViaje ?? 0
  const [viajeActivo, setViajeActivo] = useState(existing?.lugarTrabajo === 'Base' && hvExisting > 0)
  const [kmViaje, setKmViaje] = useState<number>(() =>
    existing?.lugarTrabajo === 'Campo' && hvExisting > 0 ? kmDesdeHoras(hvExisting) : 0
  )
  const [horasManuales, setHorasManuales] = useState(() =>
    existing?.lugarTrabajo === 'Campo' && hvExisting > 0 && kmDesdeHoras(hvExisting) === KM_MAX
      ? String(hvExisting).replace('.', ',') : ''
  )
  const [maneja, setManeja] = useState(existing?.maneja ?? false)

  function handleSetViaje(v: boolean) {
    setViajeActivo(v) // sólo Base (+1 h)
  }

  function handleStepChange(i: number) {
    const km = STEPS[i]
    setKmViaje(km)
    try { navigator.vibrate?.(8) } catch { /* sin vibración */ }
    if (km === 0) { setManeja(false); setHorasManuales('') }
    else if (km === KM_MAX && !horasManuales) setHorasManuales(String(horasPorKm(KM_MAX)).replace('.', ','))
  }

  function handleSetLugar(l: 'Base' | 'Campo') {
    if (l === lugar) return
    setLugar(l)
    // al cambiar de lugar se resetea el viaje: el usuario lo re-activa si corresponde
    setViajeActivo(false)
    setKmViaje(0)
    setHorasManuales('')
    setManeja(false)
  }
  const [proyectoObs, setProyectoObs] = useState(
    existing?.proyecto && existing?.observaciones && existing.proyecto !== existing.observaciones
      ? `${existing.proyecto} - ${existing.observaciones}`
      : existing?.observaciones || existing?.proyecto || ''
  )
  const [subFranco, setSubFranco] = useState<SubFranco>(getInitialSubFranco(existing))
  const [showReminder, setShowReminder] = useState(true)  // recordatorio turno noche → se auto-oculta a los 5 s

  // Auto-detect based on external context (diagrama + national calendar) + times
  const hasWork = !!(e1 && s1)
  const isPartialEntry = !!(e1 || s1) && !hasWork  // exactly one time filled → incomplete
  const isDayOff = !e1 && !s1                       // both empty → absence day
  const isFrancoWorked = esFrancoHoy && hasWork                        // diagrama franco + times → 100%
  const isFeriadoWorked = esFeriadoHoy && hasWork                      // feriado nacional + horas → 100%

  // ── Saldo de francos compensatorios en vivo ──
  // `francosDisponibles` ya incluye lo que aporta el registro guardado: se lo descuenta
  // para proyectar el saldo según lo que el usuario está eligiendo AHORA en el formulario.
  const baseFrancos = francosDisponibles
    - (existing?.esFrancoTrabajado ? 1 : 0)
    + (existing?.esFrancoCompensatorio ? 1 : 0)
  const usaCompensatorio = isDayOff && subFranco === 'COMP'
  const francosProyectados = baseFrancos + (isFrancoWorked ? 1 : 0) - (usaCompensatorio ? 1 : 0)

  // Nota estética turno noche / día + recordatorio del día anterior
  const turnoTipo = hasWork ? clasificarTurno(e1, s1) : null
  const turnoCruza = cruzaMedianocheStr(e1, s1)
  const prevTurnoNoche = !!prevDayRegistro && turnoCruzaMedianoche(prevDayRegistro)
  const prevSalida = prevTurnoNoche ? msToTime(prevDayRegistro?.salidaInicioMs) : ''

  // Reloj sugerido (no aplicado) según el último día cargado — sólo si el turno está vacío
  const turnoVacio = !e1 && !s1
  const sugEntrada = turnoVacio && lastWorkedRegistro?.entradaInicioMs ? msToTime(lastWorkedRegistro.entradaInicioMs) : ''
  const sugSalida = turnoVacio && lastWorkedRegistro?.salidaInicioMs ? msToTime(lastWorkedRegistro.salidaInicioMs) : ''
  const haySugerencia = !!sugEntrada && !!sugSalida
  const sugTipo = haySugerencia ? clasificarTurno(sugEntrada, sugSalida) : null
  function aplicarSugerencia() { setE1(sugEntrada); setS1(sugSalida) }

  // El recordatorio de turno noche se borra solo a los 5 s (la sugerencia de horario queda)
  useEffect(() => {
    if (!prevTurnoNoche) return
    const t = setTimeout(() => setShowReminder(false), 5000)
    return () => clearTimeout(t)
  }, [prevTurnoNoche])

  function handleSave() {
    if (isPartialEntry) return  // guarded by UI — button disabled when partial
    const horasViajeFinal = isDayOff ? 0
      : lugar === 'Base' ? (viajeActivo ? 1 : 0)
      : kmViaje === 0 ? 0
      : kmViaje < KM_MAX ? horasPorKm(kmViaje)
      : (parseFloat(horasManuales.replace(',', '.')) || horasPorKm(KM_MAX))
    const reg: RegistroHoras = {
      id: existing?.id ?? uuid(),
      fechaMs: fecha.getTime(),
      entradaInicioMs: isDayOff ? null : timeToMs(fecha, e1),
      salidaInicioMs: isDayOff ? null : timeToMs(fecha, s1),
      entradaFinMs: existing?.entradaFinMs ?? null,
      salidaFinMs: existing?.salidaFinMs ?? null,
      lugarTrabajo: (isDayOff ? 'Franco' : lugar) as LugarTrabajo,
      pernocte: (isDayOff || lugar === 'Base') ? 'NO' : pernocte,
      maneja: (isDayOff || lugar === 'Base') ? false : (kmViaje > 0 ? maneja : false),
      horasViaje: horasViajeFinal,
      observaciones: proyectoObs,
      proyecto: proyectoObs,
      esFeriado: esFeriadoHoy,
      esFeriadoTrabajado: isFeriadoWorked,
      esFrancoCompensatorio: isDayOff && subFranco === 'COMP',
      esFrancoTrabajado: isFrancoWorked,
      esAusenciaJustificada: isDayOff && subFranco === 'AUSENCIA',
      esFaltaInjustificada: isDayOff && subFranco === 'FALTA',
      fechaCreacion: existing?.fechaCreacion ?? Date.now(),
    }
    onSave(reg)
  }

  const closingRef = useRef(false)
  const [isClosing, setIsClosing] = useState(false)

  function handleClose() {
    if (closingRef.current) return
    closingRef.current = true
    setIsClosing(true)
    setTimeout(onClose, 230)
  }

  const labelDia = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })
  // Fechas cortas para el ejemplo del aviso de turno noche (salida 00:00)
  const hoyCorto = fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  const mananaCorto = new Date(fecha.getTime() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 ${isClosing ? 'animate-[backdrop-fade-out_230ms_ease_both]' : 'animate-[backdrop-fade-in_200ms_ease_both]'}`}
      onClick={handleClose}
    >
      <div
        className={`w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 max-h-[92vh] overflow-y-auto ${isClosing ? 'animate-[dialog-slide-out_230ms_ease_both]' : 'animate-[dialog-slide-in_220ms_ease_both]'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Editar Registro</p>
            <h2 className="text-lg font-bold text-white capitalize">{labelDia}</h2>
            {esFrancoHoy && (
              <span className="text-xs text-purple-400 flex items-center gap-1 mt-0.5">
                <CalendarDays size={12} /> Día de Franco
              </span>
            )}
            {esFeriadoHoy && (
              <span className="text-xs text-amber-400 flex items-center gap-1 mt-0.5">
                <CalendarDays size={12} /> Feriado nacional{nombreFeriadoHoy ? ` · ${nombreFeriadoHoy}` : ''}
              </span>
            )}
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white p-2"><X size={20} /></button>
        </div>

        {/* ── Recordatorio: el día anterior fue turno noche (se auto-oculta a los 5 s) ── */}
        {prevTurnoNoche && showReminder && (
          <div className="mb-4 rounded-xl bg-indigo-950/50 border border-indigo-800/50 overflow-hidden animate-[apply-bar-in_220ms_ease_both]">
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <Moon size={15} className="text-indigo-300 shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-200/90 leading-snug flex-1">
                El día anterior fue <span className="font-semibold text-indigo-100">turno noche</span>
                {prevSalida ? ` (termina ${prevSalida} hoy)` : ''}. Esas horas de la madrugada ya quedaron contadas — no las cargues de nuevo acá.
              </p>
            </div>
            {/* barra de cuenta regresiva (5 s) */}
            <div className="h-0.5 bg-indigo-500/15">
              <div className="h-full bg-indigo-400/70 animate-[countdown-bar_5s_linear_forwards]" />
            </div>
          </div>
        )}

        {/* ── Reloj sugerido según el último día cargado (persistente, no se auto-oculta) ── */}
        {haySugerencia && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-sky-950/40 border border-sky-800/40 px-3 py-2.5 animate-[apply-bar-in_220ms_ease_both]">
            <Clock size={15} className="text-sky-300 shrink-0" />
            <p className="text-xs text-sky-200/90 leading-snug flex-1 min-w-0">
              Sugerido (último día): <span className="font-semibold text-sky-100">{sugEntrada}–{sugSalida}</span> · turno {sugTipo === 'noche' ? 'noche' : 'día'}
            </p>
            <button
              onClick={aplicarSugerencia}
              className="shrink-0 rounded-lg bg-sky-500/20 border border-sky-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 active:scale-95 transition-transform"
            >
              Usar
            </button>
          </div>
        )}

        {/* ── Turno ── */}
        <div className="mb-5" data-tour="dlg-turno">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Turno</p>
          <div className="grid grid-cols-2 gap-3">
            <TimeInput label="Entrada" value={e1} onChange={setE1} />
            <TimeInput label="Salida" value={s1} onChange={setS1} />
          </div>
          {turnoTipo && (
            <div className="mt-2.5 flex items-center gap-2 animate-[apply-bar-in_220ms_ease_both]">
              {turnoTipo === 'noche' ? (
                <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-[11px] font-semibold text-indigo-300">
                  Turno noche
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                  Turno día
                </span>
              )}
              {turnoCruza && (
                <span className="text-[11px] text-slate-400">termina al día siguiente</span>
              )}
            </div>
          )}
          {/* ── Aviso: salida 00:00 → probablemente está partiendo un turno noche a mano ── */}
          {!!e1 && s1 === '00:00' && (
            <div className="mt-3 rounded-2xl overflow-hidden border border-indigo-700/50 bg-gradient-to-b from-indigo-950/70 to-slate-900/60 animate-[apply-bar-in_220ms_ease_both]">
              {/* header */}
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-indigo-900/40 border-b border-indigo-700/40">
                <span className="grid place-items-center w-7 h-7 rounded-full bg-indigo-500/25 shrink-0">
                  <Moon size={14} className="text-indigo-200" />
                </span>
                <p className="text-sm font-semibold text-indigo-100">¿Estás cargando un turno noche?</p>
              </div>

              <div className="px-3.5 py-3 space-y-3">
                <p className="text-xs text-indigo-100/85 leading-relaxed">
                  Una salida <span className="font-mono font-semibold text-indigo-200">00:00</span> suele significar que el turno
                  sigue de madrugada. En ese caso <span className="font-semibold text-indigo-100">no lo cortes en medianoche</span>:
                  cargá el turno completo en este día, con la hora real a la que salís, y la app reparte las horas sola.
                </p>

                {/* ✓ forma correcta */}
                <div className="rounded-xl bg-emerald-950/40 border border-emerald-700/40 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <Check size={13} /> Así se carga
                  </p>
                  <p className="text-xs text-emerald-100/90">
                    Un solo registro el <span className="font-semibold">{hoyCorto}</span>, de entrada a salida real
                    (ej. <span className="font-mono font-semibold text-emerald-200">{e1} → 07:00</span>).
                  </p>
                  <div className="mt-2 flex items-stretch gap-1.5 text-[11px] font-mono">
                    <div className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-600/30 px-2 py-1.5 text-center">
                      <div className="text-emerald-100/60 text-[10px]">{hoyCorto} (hoy)</div>
                      <div className="text-emerald-200 font-semibold">{e1}–00:00</div>
                    </div>
                    <div className="self-center text-emerald-400/70">+</div>
                    <div className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-600/30 px-2 py-1.5 text-center">
                      <div className="text-emerald-100/60 text-[10px]">{mananaCorto} (mañana)</div>
                      <div className="text-emerald-200 font-semibold">00:00–07:00</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-emerald-100/60 mt-1.5">↑ la app las separa así, automáticamente</p>
                </div>

                {/* ✗ forma incorrecta */}
                <div className="rounded-xl bg-rose-950/30 border border-rose-800/40 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-rose-300 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <X size={13} /> Así NO
                  </p>
                  <p className="text-xs text-rose-100/85 leading-relaxed">
                    Cargar hoy <span className="font-mono">{e1}–00:00</span> y mañana otro registro{' '}
                    <span className="font-mono">00:00–07:00</span>: las horas de la madrugada se cuentan dos veces
                    y el cálculo del período da mal.
                  </p>
                </div>
              </div>
            </div>
          )}
          {isPartialEntry && (
            <p className="text-xs text-red-400 mt-2">Ingresá tanto la Entrada como la Salida</p>
          )}
          {isFrancoWorked && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-purple-400 flex items-center gap-1">
                <CalendarDays size={12} /> Franco trabajado — horas al 100%
              </p>
              <p className="text-xs text-emerald-400 flex items-center gap-1 animate-[apply-bar-in_220ms_ease_both]">
                <Palmtree size={12} /> Ganás 1 franco compensatorio — al guardar vas a tener <span className="font-bold">{francosProyectados}</span>
              </p>
            </div>
          )}
          {isFeriadoWorked && (
            <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
              <CalendarDays size={12} /> Feriado trabajado — horas al 100%
            </p>
          )}
        </div>

        {/* ── Lugar de Trabajo — Base / Campo only ── */}
        <div className="mb-4" data-tour="dlg-lugar">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Lugar de Trabajo</p>
          <div className="flex gap-2">
            {(['Base', 'Campo'] as const).map(l => (
              <button key={l} onClick={() => handleSetLugar(l)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${lugar === l ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tipo de ausencia — only when no times entered AND not a scheduled franco day ── */}
        {isDayOff && !esFrancoHoy && (
          <div className="bg-slate-700/40 rounded-xl p-3 mb-4" data-tour="dlg-ausencia">
            <p className="text-xs text-slate-400 mb-2">Tipo de ausencia</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['COMP', 'Compensatorio'],
                ['AUSENCIA', 'Ausencia just.'],
                ['FALTA', 'Falta injust.'],
              ] as [SubFranco, string][]).map(([key, label]) => (
                <button
                  key={key!}
                  onClick={() => setSubFranco(subFranco === key ? null : key)}
                  className={`py-2 px-1 rounded-lg text-xs font-medium text-center transition-colors ${subFranco === key ? (key === 'FALTA' ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white') : 'bg-slate-700 text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            {usaCompensatorio && (
              baseFrancos > 0 ? (
                <p className="text-[11px] text-emerald-300/90 mt-2 leading-snug flex items-center gap-1 animate-[apply-bar-in_220ms_ease_both]">
                  <Palmtree size={12} className="shrink-0" /> Usás 1 franco compensatorio — al guardar te {francosProyectados === 1 ? 'queda' : 'quedan'} <span className="font-bold">{francosProyectados}</span>
                </p>
              ) : (
                <p className="text-[11px] text-amber-300/90 mt-2 leading-snug animate-[apply-bar-in_220ms_ease_both]">
                  ⚠ No tenés francos compensatorios ganados (saldo actual: {baseFrancos}). Si lo guardás igual, el saldo queda en <span className="font-bold">{francosProyectados}</span>.
                </p>
              )
            )}
            {subFranco === 'FALTA' && (
              <p className="text-[11px] text-rose-300/90 mt-2 leading-snug">
                Se descuenta el día proporcional de básico y se pierde el presentismo del período.
              </p>
            )}
          </div>
        )}

        {/* ── Pernocte / Maneja / Horas viaje — Campo only ── */}
        {!isDayOff && lugar === 'Campo' && (
          <div className="space-y-3 mb-4" data-tour="dlg-viaje">
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
            {/* Slider de viaje: 0 = sin viaje; >0 = viaje + horas + maneja */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Viaje</span>
                <span className="text-xs font-semibold text-slate-200">
                  {kmViaje === 0 ? 'Sin viaje' : kmViaje === KM_MAX ? '350+ km' : `${kmViaje} km`}
                </span>
              </div>
              <input
                type="range" min={0} max={STEPS.length - 1} step={1}
                value={STEPS.indexOf(kmViaje)}
                onChange={e => handleStepChange(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between px-0.5 mt-1">
                {STEPS.map((k, i) => (
                  <span key={i} className={`text-[9px] ${kmViaje === k ? 'text-blue-400 font-semibold' : 'text-slate-500'}`}>
                    {k === 0 ? 'No' : k === KM_MAX ? '350+' : k}
                  </span>
                ))}
              </div>
            </div>
            {kmViaje > 0 && (
              <div className="ml-3 pl-3 border-l-2 border-slate-700 space-y-3">
                <p className="text-[11px] text-slate-400 leading-snug">
                  Las horas de viaje se suman aparte de las horas de trabajo (entrada/salida).
                </p>
                {kmViaje < KM_MAX ? (
                  <p className="text-xs text-slate-400">
                    Horas de viaje: <span className="font-semibold text-slate-200">{fmtHorasViaje(horasPorKm(kmViaje))}</span>
                    <span className="text-slate-500"> · 1,5 h c/100 km</span>
                  </p>
                ) : (
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Horas de viaje (manual)</label>
                    <input
                      type="text" inputMode="decimal"
                      value={horasManuales}
                      onChange={e => { if (/^[\d.,]*$/.test(e.target.value)) setHorasManuales(e.target.value) }}
                      onBlur={() => {
                        const n = parseFloat(horasManuales.replace(',', '.'))
                        if (!Number.isFinite(n) || n < 0) { setHorasManuales(''); return }
                        setHorasManuales(String(Math.min(24, Math.round(n * 4) / 4)).replace('.', ','))
                      }}
                      placeholder="0"
                      className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                <Toggle label="Manejó este día" value={maneja} onChange={setManeja} />
              </div>
            )}
          </div>
        )}

        {/* ── Viaje a base (+1h) — Base only ── */}
        {!isDayOff && lugar === 'Base' && (
          <div className="mb-4 space-y-2">
            <Toggle label="Viaje a base (+1h)" value={viajeActivo} onChange={handleSetViaje} />
            {viajeActivo && (
              <p className="text-[11px] text-slate-400 leading-snug">
                Las horas de viaje se suman aparte de las horas de trabajo (entrada/salida).
              </p>
            )}
          </div>
        )}

        {/* ── Proyecto / Observaciones ── */}
        <div className="mb-5" data-tour="dlg-obs">
          <label className="text-xs text-slate-400 mb-1 block">Proyecto / Observaciones</label>
          <ProjectInput value={proyectoObs} onChange={setProyectoObs} suggestions={proyectosFrecuentes} />
          {proyectosFrecuentes.length === 0 && (
            <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
              Podés agregar pozos u observaciones automáticas en Configuración → Proyectos frecuentes.
            </p>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="sticky bottom-0 bg-slate-800 pt-3 pb-14 sm:pb-3 flex gap-2">
          {existing && onDelete && (
            <button onClick={() => { onDelete(existing.id); onClose() }}
              className="px-4 py-3 rounded-xl bg-red-600/20 text-red-400 text-sm font-medium">
              Eliminar
            </button>
          )}
          <button onClick={handleClose} className="flex-1 py-3 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium">Cancelar</button>
          <button onClick={handleSave} disabled={isPartialEntry}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-colors ${isPartialEntry ? 'bg-blue-600/40 text-white/40 cursor-not-allowed' : 'bg-blue-600 text-white'}`}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-slate-300 flex-1 min-w-0">{label}</span>
      {/* w-11=44px h-6=24px; knob w-5=20px h-5=20px, top-0.5=2px
          off: translate-x-0.5=2px  → knob [2px,22px] — 22px right clearance
          on:  translate-x-[22px]   → knob [22px,42px] — 2px right clearance + overflow-hidden */}
      <div
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full flex-shrink-0 cursor-pointer overflow-hidden transition-colors duration-200 ${value ? 'bg-blue-600' : 'bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${value ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </div>
    </div>
  )
}

/** Snap minutes to nearest 15-min slot (0, 15, 30, 45). Handles rollover at 60→next hour. */
function snapTo15(timeStr: string): string {
  if (!timeStr) return timeStr
  const [h, m] = timeStr.split(':').map(Number)
  const snapped = Math.round(m / 15) * 15
  const finalMin = snapped >= 60 ? 0 : snapped
  const finalHour = snapped >= 60 ? (h + 1) % 24 : h
  return `${String(finalHour).padStart(2, '0')}:${String(finalMin).padStart(2, '0')}`
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return mobile
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isMobile = useIsMobile()
  if (isMobile) return <TimeDrumPicker label={label} value={value} onChange={onChange} />
  return (
    <div className="flex-1">
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      <div className="relative">
        <input
          type="time"
          step="900"
          value={value}
          onChange={e => onChange(snapTo15(e.target.value))}
          onBlur={e => { if (e.target.value) onChange(snapTo15(e.target.value)) }}
          className="w-full bg-slate-700 text-white rounded-xl px-4 py-3 text-base font-mono
                     [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
        />
        <Clock size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
      </div>
    </div>
  )
}

function ProjectInput({ value, onChange, suggestions }: { value: string; onChange: (v: string) => void; suggestions: string[] }) {
  // Proyectos frecuentes que matchean lo tipeado, como CHIPS arriba del input (en flujo
  // normal, no dropdown flotante). Tocar un chip llena el valor SIN enfocar el input, así
  // seleccionar un frecuente no abre el teclado ni desplaza la pantalla.
  // Con muchos proyectos NO se hace una pared: se muestran hasta CHIPS_MAX y el resto se
  // accede tipeando (que filtra los chips). El contador "+N" avisa que hay más.
  const CHIPS_MAX = 8
  const q = value.trim().toLowerCase()
  const matches = suggestions.filter(s => s.toLowerCase().includes(q))
  const shown = matches.slice(0, CHIPS_MAX)
  const ocultos = matches.length - shown.length

  return (
    <div>
      {shown.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {shown.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                s === value ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 active:bg-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
          {ocultos > 0 && (
            <span className="text-[11px] text-slate-500 px-1">+{ocultos} · escribí para filtrar</span>
          )}
        </div>
      )}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Escribí o tocá un proyecto frecuente"
        className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
