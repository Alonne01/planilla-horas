import { useState, useEffect, useLayoutEffect, useRef, type FocusEvent } from 'react'
import { v4 as uuid } from 'uuid'
import { X, CalendarDays, Clock, Moon, Sun, Palmtree, Check } from 'lucide-react'
import { TimeDrumPicker } from './TimeDrumPicker'
import type { RegistroHoras } from '../db/database'
import { esFeriadoNacional, nombreFeriado } from '../lib/feriados'
import { esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'
import { turnoCruzaMedianoche, type LineaTrabajo } from '../lib/calculo-horas'

interface Props {
  fecha: Date
  existing?: RegistroHoras
  prevDayRegistro?: RegistroHoras
  lastWorkedRegistro?: RegistroHoras
  proyectosFrecuentes: string[]
  /** Línea de trabajo: habilita el toggle "On call" (guardia 24 h) en días de Campo de SBDP. */
  linea: LineaTrabajo
  diagrama: DiagramaPatternKey
  diagramaInicioMs: number
  /** Francos compensatorios disponibles ANTES de guardar este registro */
  francosDisponibles: number
  onSave: (reg: RegistroHoras) => void
  onDelete?: (id: string) => void
  onClose: () => void
  /** Tour: se dispara una vez cuando entrada y salida quedan cargadas (modo demo). */
  onTourReady?: () => void
  /** Tour guiado: oculta Cancelar y la X (sólo se puede Guardar; para salir está "Omitir" del tour). */
  ocultarCierre?: boolean
  /** Centro (viewport) de la celda tocada → el diálogo CRECE desde ahí ("container transform"). */
  origin?: { x: number; y: number } | null
  /** Preferencia: al salir con cambios sin guardar, guardar siempre sin preguntar. */
  guardarSiempreAlSalir?: boolean
  /** Persiste la preferencia "guardar siempre al salir" (efecto inmediato). */
  onSetGuardarSiempre?: (v: boolean) => void
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

// Viaje (Campo): 4 opciones en vez del slider. No viaja = 0 h; −300 km = 3 h; +300 km = 4 h; Otro =
// el usuario carga km (informativo) y horas a mano. Sólo `horasViaje` cuenta; `kmViaje` es una nota.
type ViajeModo = 'NO' | 'M300' | 'P300' | 'OTRO'
const HORAS_VIAJE_FIJAS: Record<'M300' | 'P300', number> = { M300: 3, P300: 4 }

function getInitialViaje(existing: RegistroHoras | undefined): { modo: ViajeModo; km: string; horas: string } {
  const hv = existing?.horasViaje ?? 0
  if (existing?.lugarTrabajo !== 'Campo' || hv <= 0) return { modo: 'NO', km: '', horas: '' }
  if (hv === HORAS_VIAJE_FIJAS.M300) return { modo: 'M300', km: '', horas: '' }
  if (hv === HORAS_VIAJE_FIJAS.P300) return { modo: 'P300', km: '', horas: '' }
  // Cualquier otro valor (incluye los del slider viejo: 1,5 / 4,5 / 6 / 7,5 / manual) → "Otro".
  return { modo: 'OTRO', km: existing?.kmViaje ? String(existing.kmViaje).replace('.', ',') : '', horas: String(hv).replace('.', ',') }
}

/** Mutually-exclusive absence labels — shown only when no times entered */
type SubFranco = 'COMP' | 'AUSENCIA' | 'FALTA' | 'VACACIONES' | null

function getInitialSubFranco(existing: RegistroHoras | undefined): SubFranco {
  if (!existing) return null
  if (existing.esFrancoCompensatorio) return 'COMP'
  if (existing.esAusenciaJustificada) return 'AUSENCIA'
  if (existing.esFaltaInjustificada) return 'FALTA'
  if (existing.esVacaciones) return 'VACACIONES'
  return null
}

// Tipo de día de guardia on-call (SBDP, Campo): define el horario que va a la planilla.
//  LLEGADA = entrada → 00:00 · COMPLETO = 00:00 → 00:00 (24 h) · VUELTA = 00:00 → llegada
type TipoDiaSBDP = 'LLEGADA' | 'COMPLETO' | 'VUELTA' | null

/** Infiere el tipo de día on-call de un registro SBDP de Campo según sus horarios. */
function getInitialTipoDia(existing: RegistroHoras | undefined, linea: LineaTrabajo): TipoDiaSBDP {
  if (linea !== 'SBDP' || existing?.lugarTrabajo !== 'Campo') return null
  const e = msToTime(existing?.entradaInicioMs)
  const s = msToTime(existing?.salidaInicioMs)
  if (!e || !s) return null
  if (e === s) return 'COMPLETO'        // 00:00 → 00:00 (día completo de 24 h)
  if (s === '00:00') return 'LLEGADA'   // entrada → 00:00
  if (e === '00:00') return 'VUELTA'    // 00:00 → llegada
  return null                            // horario libre heredado: sin patrón
}

export function RegistroDialog({ fecha, existing, prevDayRegistro, lastWorkedRegistro, proyectosFrecuentes, linea, diagrama, diagramaInicioMs, francosDisponibles, onSave, onDelete, onClose, onTourReady, ocultarCierre, origin, guardarSiempreAlSalir, onSetGuardarSiempre }: Props) {
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
  const initialViaje = getInitialViaje(existing)
  const [viajeModo, setViajeModo] = useState<ViajeModo>(initialViaje.modo)
  const [kmManual, setKmManual] = useState(initialViaje.km)       // km informativo (opción "Otro")
  const [horasManual, setHorasManual] = useState(initialViaje.horas) // horas que cuentan (opción "Otro")
  const [maneja, setManeja] = useState(existing?.maneja ?? false)
  // SBDP trabaja "on call": en días de Campo el horario se carga según el TIPO de día (llegada al
  // campo → entrada/00:00; día completo → 00:00/00:00 de 24 h; vuelta a base → 00:00/llegada). El
  // tipo define entrada/salida; el sueldo siempre es 12 h al 50% (lo fija la línea SBDP).
  const esSBDPCampo = linea === 'SBDP' && lugar === 'Campo'
  const [tipoDia, setTipoDia] = useState<TipoDiaSBDP>(getInitialTipoDia(existing, linea))

  function handleSetTipoDia(t: TipoDiaSBDP) {
    setTipoDia(t)
    try { navigator.vibrate?.(8) } catch { /* sin vibración */ }
    if (t === 'COMPLETO') { setE1('00:00'); setS1('00:00') }
    else if (t === 'LLEGADA') { setS1('00:00'); setE1(e1 && e1 !== '00:00' ? e1 : '') }
    else if (t === 'VUELTA') { setE1('00:00'); setS1(s1 && s1 !== '00:00' ? s1 : '') }
  }

  // Tour: avisar una vez cuando se cargan entrada y salida.
  const tourReadyFired = useRef(false)
  useEffect(() => {
    if (onTourReady && e1 && s1 && !tourReadyFired.current) { tourReadyFired.current = true; onTourReady() }
  }, [e1, s1])

  function handleSetViaje(v: boolean) {
    setViajeActivo(v) // sólo Base (+1 h)
  }

  function handleSetViajeModo(m: ViajeModo) {
    setViajeModo(m)
    try { navigator.vibrate?.(8) } catch { /* sin vibración */ }
    if (m === 'NO') { setManeja(false); setKmManual(''); setHorasManual('') }
  }

  // Normaliza las horas manuales (opción "Otro") al salir del campo: [0, 24] redondeado a 0,25.
  function normalizarHorasManual() {
    const n = parseFloat(horasManual.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) { setHorasManual(''); return }
    setHorasManual(String(Math.min(24, Math.round(n * 4) / 4)).replace('.', ','))
  }

  function handleSetLugar(l: 'Base' | 'Campo') {
    if (l === lugar) return
    setLugar(l)
    // al cambiar de lugar se resetea el viaje: el usuario lo re-activa si corresponde
    setViajeActivo(false)
    setViajeModo('NO')
    setKmManual('')
    setHorasManual('')
    setManeja(false)
    setTipoDia(null)  // el tipo de día on-call sólo aplica a Campo (SBDP); se re-elige al volver
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

  // Prefijo/sufijo que la EXPORTACIÓN agrega sola a la observación (réplica de excel-export):
  // el "franco/feriado trabajado", el tipo de ausencia y el turno TD/TN de Campo. Se muestran como
  // texto fantasma (gris, no editable) dentro del campo, para que se vea que no hay que escribirlos.
  const obsPrefijo = isFrancoWorked ? 'franco trabajado'
    : isFeriadoWorked ? 'feriado trabajado'
    : isDayOff ? (
        subFranco === 'FALTA' ? 'falta injustificada'
        : subFranco === 'AUSENCIA' ? 'ausencia just.'
        : subFranco === 'VACACIONES' ? 'vacaciones'
        : esFeriadoHoy ? 'feriado'
        : subFranco === 'COMP' ? 'franco (comp.)'
        : esFrancoHoy ? 'franco'
        : ''
      )
    : ''
  const obsSufijo = (!isDayOff && lugar === 'Campo' && turnoTipo) ? (turnoTipo === 'noche' ? 'TN' : 'TD') : ''

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
      : viajeModo === 'NO' ? 0
      : viajeModo === 'OTRO' ? (parseFloat(horasManual.replace(',', '.')) || 0)
      : HORAS_VIAJE_FIJAS[viajeModo]
    // km: sólo informativo y sólo en la opción "Otro" (no afecta el cálculo).
    const kmViajeFinal = (!isDayOff && lugar === 'Campo' && viajeModo === 'OTRO')
      ? (parseFloat(kmManual.replace(',', '.')) || undefined)
      : undefined
    const reg: RegistroHoras = {
      id: existing?.id ?? uuid(),
      fechaMs: fecha.getTime(),
      entradaInicioMs: isDayOff ? null : timeToMs(fecha, e1),
      salidaInicioMs: isDayOff ? null : timeToMs(fecha, s1),
      entradaFinMs: existing?.entradaFinMs ?? null,
      salidaFinMs: existing?.salidaFinMs ?? null,
      lugarTrabajo: (isDayOff ? 'Franco' : lugar) as LugarTrabajo,
      pernocte: (isDayOff || lugar === 'Base') ? 'NO' : pernocte,
      maneja: (isDayOff || lugar === 'Base') ? false : (viajeModo !== 'NO' ? maneja : false),
      horasViaje: horasViajeFinal,
      kmViaje: kmViajeFinal,
      observaciones: proyectoObs,
      proyecto: proyectoObs,
      esFeriado: esFeriadoHoy,
      esFeriadoTrabajado: isFeriadoWorked,
      esFrancoCompensatorio: isDayOff && subFranco === 'COMP',
      esFrancoTrabajado: isFrancoWorked,
      esAusenciaJustificada: isDayOff && subFranco === 'AUSENCIA',
      esFaltaInjustificada: isDayOff && subFranco === 'FALTA',
      esVacaciones: isDayOff && subFranco === 'VACACIONES',
      // Guardia on-call SBDP: día de Campo trabajado con un tipo de día elegido (no en ausencias).
      esOnCall: !isDayOff && lugar === 'Campo' && linea === 'SBDP' && tipoDia != null,
      fechaCreacion: existing?.fechaCreacion ?? Date.now(),
    }
    onSave(reg)
  }

  const closingRef = useRef(false)
  const [isClosing, setIsClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // "Container transform": al abrir desde una celda, el panel CRECE desde el punto tocado. Seteamos la
  // transform-origin (punto de la celda relativo al panel) antes del primer paint y disparamos la
  // animación de crecer; reemplaza al slide normal. Sin `origin` (lista, etc.) queda el slide del CSS.
  // El "container transform" (crecer desde la celda) se limita a DESKTOP (≥640px = `sm`, donde el
  // diálogo ya es un modal centrado). En móvil es un bottom-sheet → queda el slide-up de siempre.
  const usaGrow = () => !!origin && typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el || !usaGrow()) return
    el.style.animation = 'none'           // medir la posición de REPOSO (sin el slide-in del CSS)
    const r = el.getBoundingClientRect()  // fuerza reflow → rect real del panel
    el.style.transformOrigin = `${origin!.x - r.left}px ${origin!.y - r.top}px`
    el.style.animation = 'container-grow-in 300ms cubic-bezier(.22,1,.36,1) both'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClose() {
    if (closingRef.current) return
    closingRef.current = true
    // Cierre simétrico: si creció desde una celda (desktop), vuelve a encogerse hacia ella.
    const grow = usaGrow() && !!panelRef.current
    if (grow) panelRef.current!.style.animation = 'container-grow-out 220ms cubic-bezier(.5,0,.75,0) forwards'
    setIsClosing(true)
    setTimeout(onClose, grow ? 220 : 230)
  }

  // ── Cambios sin guardar ──────────────────────────────────────────────────────
  // Snapshot de los campos editables en el 1er render; si el estado actual difiere, hay cambios.
  const camposActuales = JSON.stringify({ lugar, e1, s1, pernocte, viajeActivo, viajeModo, kmManual, horasManual, maneja, tipoDia, proyectoObs, subFranco })
  const snapshotInicial = useRef(camposActuales)
  const hayCambios = snapshotInicial.current !== camposActuales
  const [showConfirmExit, setShowConfirmExit] = useState(false)

  // Punto único de salida (backdrop, X, Cancelar). Sin cambios → cierra. Con cambios → según la
  // preferencia: "guardar siempre" guarda directo (si es válido); si no, abre el diálogo.
  function requestClose() {
    if (!hayCambios) { handleClose(); return }
    if (guardarSiempreAlSalir && !isPartialEntry) { handleSave(); return }
    setShowConfirmExit(true)
  }

  const labelDia = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })
  // Fechas cortas para el ejemplo del aviso de turno noche (salida 00:00)
  const hoyCorto = fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  const mananaCorto = new Date(fecha.getTime() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 ${isClosing ? 'animate-[backdrop-fade-out_230ms_ease_both]' : 'animate-[backdrop-fade-in_200ms_ease_both]'}`}
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 max-h-[92vh] overflow-y-auto ${isClosing ? 'animate-[dialog-slide-out_230ms_ease_both]' : 'animate-[dialog-slide-in_220ms_ease_both]'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — degradé sutil DÍA/NOCHE que cambia según el turno cargado (sol→luna). */}
        <div
          className="flex items-center justify-between mb-5 -mx-5 -mt-5 px-5 pt-5 pb-3 rounded-t-2xl transition-[background] duration-500"
          style={{ background: turnoTipo === 'noche' ? 'linear-gradient(180deg, rgba(99,102,241,0.18), transparent)' : turnoTipo === 'dia' ? 'linear-gradient(180deg, rgba(251,191,36,0.15), transparent)' : undefined }}
        >
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
          {!ocultarCierre && <button onClick={requestClose} className="text-slate-400 hover:text-white p-2"><X size={20} /></button>}
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
        <div className="mb-5" data-tour="dlg-turno" data-completo={e1 && s1 ? '1' : '0'}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Turno{esSBDPCampo ? ' · on-call' : ''}</p>
          {esSBDPCampo ? (
            // SBDP on-call: el TIPO de día define el horario. El sueldo es 12 h al 50% siempre.
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['LLEGADA', 'Llegada', 'al campo'],
                  ['COMPLETO', 'Día completo', '24 h'],
                  ['VUELTA', 'Vuelta', 'a base'],
                ] as [Exclude<TipoDiaSBDP, null>, string, string][]).map(([key, label, sub]) => (
                  <button key={key} type="button" onClick={() => handleSetTipoDia(key)}
                    className={`py-2.5 px-1 rounded-xl text-sm font-medium text-center leading-tight transition-[transform,background-color,color] active:scale-95 ${tipoDia === key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                    {label}
                    <span className={`block text-[10px] ${tipoDia === key ? 'text-blue-100/80' : 'text-slate-400'}`}>{sub}</span>
                  </button>
                ))}
              </div>
              {tipoDia === 'COMPLETO' && (
                <div className="rounded-xl bg-slate-700/40 px-3 py-3 text-center animate-[apply-bar-in_220ms_ease_both]">
                  <p className="font-mono text-lg text-white">00:00 → 00:00</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Día completo de guardia (pernocte)</p>
                </div>
              )}
              {tipoDia === 'LLEGADA' && (
                <div className="animate-[apply-bar-in_220ms_ease_both]">
                  <TimeInput label="Hora de entrada al campo" value={e1} onChange={setE1} />
                  <p className="text-[11px] text-slate-400 mt-1.5">La salida queda en 00:00 (medianoche).</p>
                </div>
              )}
              {tipoDia === 'VUELTA' && (
                <div className="animate-[apply-bar-in_220ms_ease_both]">
                  <TimeInput label="Hora de llegada a base" value={s1} onChange={setS1} />
                  <p className="text-[11px] text-slate-400 mt-1.5">La entrada queda en 00:00 (medianoche).</p>
                </div>
              )}
              {tipoDia === null && (
                <p className="text-xs text-slate-400">
                  Elegí el tipo de día de guardia.{(e1 && s1) ? ` Horario cargado: ${e1}–${s1}.` : ''}
                </p>
              )}
              <p className="text-[11px] text-amber-300/90">SBDP on-call: este día cuenta 12 h al 50%.</p>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3">
            <TimeInput label="Entrada" value={e1} onChange={setE1} />
            <TimeInput label="Salida" value={s1} onChange={setS1} />
          </div>
          {turnoTipo && (
            <div className="mt-2.5 flex items-center gap-2 animate-[apply-bar-in_220ms_ease_both]">
              {turnoTipo === 'noche' ? (
                <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 flex items-center gap-1">
                  <Moon size={12} /> Turno noche
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                  <Sun size={12} /> Turno día
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
          </>
          )}
          {/* Slot de altura fija: evita que el aviso "media carga" empuje el resto del diálogo. */}
          <div className="min-h-[1.15rem] mt-2">
            {isPartialEntry && (
              <p className="text-xs text-red-400">
                {esSBDPCampo
                  ? (tipoDia === 'LLEGADA' ? 'Ingresá la hora de entrada al campo' : 'Ingresá la hora de llegada a base')
                  : 'Ingresá tanto la Entrada como la Salida'}
              </p>
            )}
          </div>
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
              <button key={l} data-tour={`dlg-lugar-${l.toLowerCase()}`} onClick={() => handleSetLugar(l)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-[transform,background-color,color] active:scale-95 ${lugar === l ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tipo de ausencia — only when no times entered AND not a scheduled franco day ── */}
        {isDayOff && !esFrancoHoy && (
          <div className="bg-slate-700/40 rounded-xl p-3 mb-4 animate-[apply-bar-in_240ms_ease_both]" data-tour="dlg-ausencia">
            <p className="text-xs text-slate-400 mb-2">Tipo de ausencia</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['COMP', 'Compensatorio'],
                ['AUSENCIA', 'Ausencia just.'],
                ['FALTA', 'Falta injust.'],
                ['VACACIONES', 'Vacaciones'],
              ] as [SubFranco, string][]).map(([key, label]) => {
                const sel = subFranco === key
                const selColor = key === 'FALTA' ? 'bg-rose-600 text-white'
                  : key === 'VACACIONES' ? 'bg-teal-600 text-white'
                  : 'bg-blue-600 text-white'
                return (
                  <button
                    key={key!}
                    onClick={() => setSubFranco(sel ? null : key)}
                    className={`py-2 px-1 rounded-lg text-xs font-medium text-center transition-[transform,background-color,color] active:scale-95 ${sel ? selColor : 'bg-slate-700 text-slate-300'}`}>
                    {label}
                  </button>
                )
              })}
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
          <div className="space-y-3 mb-4 animate-[apply-bar-in_240ms_ease_both]" data-tour="dlg-viaje">
            <div data-tour="dlg-pernocte">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Pernocte</p>
              <div className="flex gap-2">
                {(['NO', 'Hotel', 'Trailer'] as Pernocte[]).map(p => (
                  <button key={p} onClick={() => setPernocte(p)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-[transform,background-color,color] active:scale-95 ${pernocte === p ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            {/* Viaje: 4 opciones (No viaja / −300 km=3 h / +300 km=4 h / Otro) en vez del slider */}
            <div data-tour="dlg-viaje-modo">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Viaje</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['NO', 'No viaja', ''],
                  ['M300', '−300 km', '3 h'],
                  ['P300', '+300 km', '4 h'],
                  ['OTRO', 'Otro', ''],
                ] as [ViajeModo, string, string][]).map(([key, label, sub]) => (
                  <button key={key} onClick={() => handleSetViajeModo(key)}
                    className={`py-2.5 rounded-xl text-sm font-medium transition-[transform,background-color,color] active:scale-95 ${viajeModo === key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                    {label}
                    {sub && <span className={`block text-[10px] ${viajeModo === key ? 'text-blue-100/80' : 'text-slate-400'}`}>{sub}</span>}
                  </button>
                ))}
              </div>
            </div>
            {viajeModo !== 'NO' && (
              <div className="ml-3 pl-3 border-l-2 border-slate-700 space-y-3">
                <p className="text-[11px] text-slate-400 leading-snug">
                  Las horas de viaje se suman aparte de las horas de trabajo (entrada/salida).
                </p>
                {viajeModo === 'OTRO' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Km (opcional)</label>
                      <input
                        type="text" inputMode="decimal" value={kmManual}
                        onChange={e => { if (/^[\d.,]*$/.test(e.target.value)) setKmManual(e.target.value) }}
                        placeholder="ej: 350"
                        className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Horas de viaje</label>
                      <input
                        type="text" inputMode="decimal" value={horasManual}
                        onChange={e => { if (/^[\d.,]*$/.test(e.target.value)) setHorasManual(e.target.value) }}
                        onBlur={normalizarHorasManual}
                        placeholder="0"
                        className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Horas de viaje: <span className="font-semibold text-slate-200">{viajeModo === 'M300' ? '3 h' : '4 h'}</span>
                  </p>
                )}
                <div data-tour="dlg-maneja">
                  <Toggle label="Manejó este día" value={maneja} onChange={setManeja} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Viaje a base (+1h) — Base only ── */}
        {!isDayOff && lugar === 'Base' && (
          <div className="mb-4 space-y-2 animate-[apply-bar-in_240ms_ease_both]" data-tour="dlg-viaje-base">
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
          <ProjectInput value={proyectoObs} onChange={setProyectoObs} suggestions={proyectosFrecuentes} prefijo={obsPrefijo} sufijo={obsSufijo} />
          {(obsPrefijo || obsSufijo) ? (
            <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
              El texto en <span className="italic text-slate-400">gris</span> se agrega solo al exportar — no lo escribas.
            </p>
          ) : proyectosFrecuentes.length === 0 && (
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
          {!ocultarCierre && <button onClick={requestClose} className="flex-1 py-3 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium transition-transform active:scale-95">Cancelar</button>}
          <button data-tour="dlg-guardar" onClick={handleSave} disabled={isPartialEntry}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-[transform,background-color,color] active:scale-95 disabled:active:scale-100 ${isPartialEntry ? 'bg-blue-600/40 text-white/40 cursor-not-allowed' : 'bg-blue-600 text-white'}`}>
            Guardar
          </button>
        </div>
      </div>

      {/* ── Confirmar salida con cambios sin guardar ── */}
      {showConfirmExit && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-5 animate-[backdrop-fade-in_150ms_ease_both]"
          onClick={e => { e.stopPropagation(); setShowConfirmExit(false) }}
        >
          <div
            className="w-full max-w-xs bg-slate-800 rounded-2xl p-5 shadow-2xl ring-1 ring-white/10 animate-[dialog-slide-in_180ms_ease_both]"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-white">¿Guardar los cambios?</h3>
            <p className="text-xs text-slate-400 mt-1">Hiciste cambios en este día y todavía no los guardaste.</p>
            <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!guardarSiempreAlSalir}
                onChange={e => onSetGuardarSiempre?.(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600 shrink-0"
              />
              <span className="text-xs text-slate-300">Guardar siempre al salir (no volver a preguntar)</span>
            </label>
            {isPartialEntry && (
              <p className="text-[11px] text-red-400 mt-3">Para guardar este día ingresá entrada y salida; si no, sólo podés descartar.</p>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setShowConfirmExit(false); handleClose() }}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium transition-transform active:scale-95"
              >
                Descartar
              </button>
              <button
                onClick={() => { setShowConfirmExit(false); handleSave() }}
                disabled={isPartialEntry}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-transform active:scale-95 ${isPartialEntry ? 'bg-blue-600/40 text-white/40 cursor-not-allowed' : 'bg-blue-600 text-white'}`}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!value)} className="flex items-center justify-between gap-2 cursor-pointer select-none">
      <span className="text-sm text-slate-300 flex-1 min-w-0">{label}</span>
      {/* w-11=44px h-6=24px; knob w-5=20px h-5=20px, top-0.5=2px
          off: translate-x-0.5=2px  → knob [2px,22px] — 22px right clearance
          on:  translate-x-[22px]   → knob [22px,42px] — 2px right clearance + overflow-hidden */}
      <div
        className={`relative w-11 h-6 rounded-full flex-shrink-0 overflow-hidden transition-colors duration-200 ${value ? 'bg-blue-600' : 'bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${value ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </div>
    </div>
  )
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

const HORAS_PC = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTOS_PC = ['00', '15', '30', '45']

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isMobile = useIsMobile()
  if (isMobile) return <TimeDrumPicker label={label} value={value} onChange={onChange} />
  // PC: dos selectores 24 h (sin AM/PM, sin estados "media carga"). El minuto cae a :00 al elegir la hora.
  const hh = value ? value.split(':')[0] : ''
  const mm = value ? value.split(':')[1] : ''
  const setPart = (h: string, m: string) => {
    if (!h && !m) { onChange(''); return }
    onChange(`${h || '00'}:${m || '00'}`)
  }
  const selCls = 'flex-1 min-w-0 bg-slate-700 text-white text-center font-mono text-lg rounded-xl py-2.5 [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors'
  return (
    <div className="flex-1 min-w-0">
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      <div className="flex items-stretch gap-1 rounded-2xl bg-slate-900/70 ring-1 ring-white/[0.06] p-1.5">
        <select value={hh} onChange={e => setPart(e.target.value, mm)} className={selCls} aria-label={`${label} (hora)`}>
          <option value="" disabled>– –</option>
          {HORAS_PC.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="self-center font-mono font-bold text-slate-400 text-lg">:</span>
        <select value={mm} onChange={e => setPart(hh, e.target.value)} className={selCls} aria-label={`${label} (minutos)`}>
          <option value="" disabled>– –</option>
          {MINUTOS_PC.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  )
}

function ProjectInput({ value, onChange, suggestions, prefijo, sufijo }: { value: string; onChange: (v: string) => void; suggestions: string[]; prefijo?: string; sufijo?: string }) {
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

  // Mantener el campo visible sobre el teclado (scrollIntoView 'center' no alcanza si el teclado tapa
  // medio diálogo): desplaza el scroller para dejar el input a ~1/3 del área visible.
  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    setTimeout(() => {
      const vv = window.visualViewport
      const scroller = el.closest('.overflow-y-auto') as HTMLElement | null
      if (vv && scroller) {
        const r = el.getBoundingClientRect()
        const objetivo = vv.offsetTop + vv.height * 0.35  // ~1/3 desde arriba del área visible
        scroller.scrollTop += r.top - objetivo
      } else {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }, 300)
  }

  return (
    <div>
      {shown.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {shown.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-[transform,background-color,color] active:scale-95 ${
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
      {(prefijo || sufijo) ? (
        // El prefijo/sufijo (franco/feriado trabajado, tipo de ausencia, turno TD/TN) se muestra como
        // texto FANTASMA gris, no editable, flanqueando lo que el usuario escribe (se agrega solo al exportar).
        <div className="flex items-center w-full bg-slate-700 rounded-xl px-3 focus-within:ring-2 focus-within:ring-blue-500">
          {prefijo && <span className="shrink-0 text-xs italic text-slate-500 select-none mr-1">{prefijo}{value ? ' -' : ''}</span>}
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={handleFocus}
            placeholder="Escribí o tocá un proyecto frecuente"
            className="flex-1 min-w-0 bg-transparent text-white py-2 text-sm placeholder:text-slate-500 focus:outline-none"
          />
          {sufijo && <span className="shrink-0 text-xs italic text-slate-500 select-none ml-1">{sufijo}</span>}
        </div>
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={handleFocus}
          placeholder="Escribí o tocá un proyecto frecuente"
          className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  )
}
