import { useState, useMemo, useEffect, useRef } from 'react'
import { FileText, FileBarChart, Upload, X, LayoutGrid, List, Copy, Check, Lightbulb, MoreVertical, Trash2, CalendarX2, Download } from 'lucide-react'
import { useHoras, useFrancoCounter } from '../hooks/useHoras'
import { useSettings } from '../hooks/useSettings'
import { RegistroDialog } from '../components/RegistroDialog'
import { DayCard } from '../components/DayCard'
import { CalendarGrid } from '../components/CalendarGrid'
import { ResumenBar } from '../components/ResumenBar'
import { BgBlobs } from '../components/BgBlobs'
import { calcularResumenPeriodo } from '../lib/calculo-horas'
import { defaultPeriodoMes, defaultPeriodoAnio, diasDelPeriodo, MESES_ES, DIAGRAMAS, periodoStart, periodoEnd, fechaCobro, esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'
import { esFeriadoNacional } from '../lib/feriados'
import { exportarExcelNormal } from '../lib/excel-export'
import { exportarExcelCompleto } from '../lib/excel-export-full'
import { registrarExportacion } from '../lib/metricas'
import { DonadorDonacion, DonadorGracias } from '../components/DonadorDonacion'
import { esBeggarUnlock } from '../lib/calculo-salarial'
import { db, shadowBackup, type RegistroHoras } from '../db/database'

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Clave del estado del beggar por IDENTIDAD (usuario+código), no por dispositivo. */
function beggarIdKey(usuario: string, codigo: string): string {
  const u = (usuario || '').trim().toLowerCase()
  const c = (codigo || '').trim()
  return u && c ? `${u}|${c}` : 'anon'
}

// Cuenta cuántas veces se entró a la planilla en ESTA sesión de app (la página se monta por pestaña).
// Se reinicia al recargar. El donador sale seguro en la 3ª visita y, en otras, al azar.
let visitasPlanilla = 0
// Si ya se exportó en ESTA sesión: evita re-disparar el "entró a la app luego de exportar"
// (ese disparo es para la PRÓXIMA apertura de la app, no para la sesión donde se exportó).
let exportadoEnEstaSesion = false


/** Reconstruye la fecha (mediodía) desde una clave `año-mes-día`. */
function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m, d, 12, 0, 0)
}

/**
 * Clona los datos de `source` hacia `target`. Si el destino es franco/feriado y
 * el origen tiene trabajo, queda marcado como franco/feriado trabajado (en el
 * cálculo y en el badge). A nivel de módulo para no analizarse como render.
 */
function cloneForDate(source: RegistroHoras, target: Date, diagrama: DiagramaPatternKey, diagramaInicioMs: number): RegistroHoras {
  const targetMs = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 12, 0, 0).getTime()
  const isFranco = esFrancoPorDiagrama(targetMs, diagrama, diagramaInicioMs)
  const isFeriado = esFeriadoNacional(targetMs)
  const hasWork = source.entradaInicioMs !== null || source.salidaInicioMs !== null

  // Si el origen era franco sin trabajo y se copia a un día normal, default lugar = Campo
  let lugarTrabajo = source.lugarTrabajo
  if (lugarTrabajo === 'Franco' && !isFranco) lugarTrabajo = 'Campo'
  if (isFranco && !hasWork) lugarTrabajo = 'Franco'

  return {
    ...source,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fechaMs: targetMs,
    fechaCreacion: Date.now(),
    lugarTrabajo,
    esFrancoTrabajado: isFranco && hasWork,
    esFeriado: isFeriado && !hasWork,
    esFeriadoTrabajado: isFeriado && hasWork,
    esFrancoCompensatorio: false,
    esAusenciaJustificada: false,
    esFaltaInjustificada: false,
    esVacaciones: false,
  }
}

export function HorasTrabajoPage({ beggarActivo = false, onAbrirTutorial }: { beggarActivo?: boolean; onAbrirTutorial?: () => void }) {
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const { registros, loading, upsert, remove, reload } = useHoras(mes, anio)
  const { settings, update } = useSettings()
  // El beggar decide su aparición por usuario+código (no por dispositivo). idKeyRef = siempre fresco.
  const idKey = useMemo(() => beggarIdKey(settings.nombreUsuario, settings.backupCodigo), [settings.nombreUsuario, settings.backupCodigo])
  const idKeyRef = useRef(idKey)
  idKeyRef.current = idKey
  const francosDisponibles = useFrancoCounter(registros)

  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [dialogOrigin, setDialogOrigin] = useState<{ x: number; y: number } | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const [showCopyTip, setShowCopyTip] = useState(() => {
    try { return localStorage.getItem('planilla-tip-copiar') !== 'dismissed' } catch { return true }
  })

  function dismissCopyTip() {
    setShowCopyTip(false)
    try { localStorage.setItem('planilla-tip-copiar', 'dismissed') } catch { /* ignore */ }
  }

  // Agradecimiento al volver de donar: si tocó el link y tardó >1 min en volver,
  // probablemente donó → el personaje agradece (heurística, sin backend).
  const [graciasVisible, setGraciasVisible] = useState(false)
  // El donador se remonta (key nueva) en cada disparo: 3ª visita, al azar, al exportar, o al
  // entrar a la app luego de exportar. `beggarVisible` decide si se muestra en esta página montada.
  const [beggarKey, setBeggarKey] = useState(0)
  const [beggarVisible, setBeggarVisible] = useState(false)
  // Si ya donó en las últimas 24 h (por usuario+código), no aparece más el donador.
  // Se inicializa en el effect de identidad (depende de settings, que carga async).
  const [yaAgradecioHoy, setYaAgradecioHoy] = useState(false)
  useEffect(() => {
    function check() {
      if (document.visibilityState !== 'visible') return
      try {
        const ts = Number(localStorage.getItem('planilla-donacion-ts') || 0)
        if (!ts) return
        localStorage.removeItem('planilla-donacion-ts')
        const elapsed = Date.now() - ts
        const donoKey = `planilla-dono-ts:${idKeyRef.current}`
        const donoTs = Number(localStorage.getItem(donoKey) || 0)
        const yaDono24h = donoTs > 0 && Date.now() - donoTs < 24 * 60 * 60 * 1000
        // Mostrar el "gracias" sólo una vez por 24 h (por usuario+código).
        if (elapsed > 60_000 && elapsed < 30 * 60_000 && !yaDono24h) {
          localStorage.setItem(donoKey, String(Date.now()))
          setYaAgradecioHoy(true)
          setGraciasVisible(true)
        }
      } catch { /* ignore */ }
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    check()
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
    }
  }, [])

  // yaAgradecioHoy se decide por usuario+código: se sincroniza según la identidad.
  useEffect(() => {
    try {
      const ts = Number(localStorage.getItem(`planilla-dono-ts:${idKey}`) || 0)
      setYaAgradecioHoy(ts > 0 && Date.now() - ts < 24 * 60 * 60 * 1000)
    } catch { /* ignore */ }
    // "La próxima vez que entra a la app luego de exportar": si quedó la marca de una exportación
    // de una sesión ANTERIOR (no de ésta), mostrar el donador una vez y limpiar la marca.
    try {
      const k = `planilla-beggar-post-export:${idKey}`
      if (!exportadoEnEstaSesion && localStorage.getItem(k) === '1') {
        localStorage.removeItem(k)
        setBeggarVisible(true)
        setBeggarKey(n => n + 1)
      }
    } catch { /* ignore */ }
  }, [idKey])

  // Donador por VISITAS: "salga aleatorio, a la tercera vez de ir a la planilla". Cada entrada a la
  // planilla suma una visita; la 3ª lo muestra seguro y, en otras visitas, sale al azar (~1 de 4).
  useEffect(() => {
    visitasPlanilla += 1
    if (visitasPlanilla === 3 || Math.random() < 0.25) {
      setBeggarVisible(true)
      setBeggarKey(n => n + 1)
    }
  }, [])
  // ─── Modo "aplicar datos a otro día": se pintan los días destino (tocando o arrastrando) ───
  const [applySource, setApplySource] = useState<RegistroHoras | null>(null)
  const [applySourceKey, setApplySourceKey] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState<Date | null>(null)        // pregunta "¿Aplicar a otro día?"
  const [paintedKeys, setPaintedKeys] = useState<Set<string>>(new Set())     // días pintados (aún sin escribir en DB)
  const [confirmCommit, setConfirmCommit] = useState<number | null>(null)    // nº de días con datos a sobrescribir (pendiente de confirmar)
  const [pulseKey, setPulseKey] = useState<string | null>(null)
  // Días recién REESCRITOS (copiados/borrados): animación de "reescritura" escalonada SÓLO en esos
  // días; el resto del calendario queda estático (no se re-monta). `token` incrementa para re-disparar.
  const [rewrite, setRewrite] = useState<{ keys: Set<string>; token: number; prev: Map<string, RegistroHoras | undefined>; stagger: boolean }>({ keys: new Set(), token: 0, prev: new Map(), stagger: true })
  const rewriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function triggerRewrite(keys: Set<string>, prev: Map<string, RegistroHoras | undefined>, stagger = true) {
    if (keys.size === 0) return
    if (rewriteTimer.current) clearTimeout(rewriteTimer.current)
    setRewrite(p => ({ keys: new Set(keys), token: p.token + 1, prev, stagger }))
    // Limpiar las keys recién cuando TODA la cascada terminó. Escalonado: 0,3s base + 80ms por día +
    // ~0,8s de animación; simultáneo (borrar período): sólo 0,3s base + 0,8s (todos giran a la vez).
    const total = stagger ? 300 + keys.size * 80 + 800 : 300 + 800
    rewriteTimer.current = setTimeout(() => setRewrite(p => ({ keys: new Set(), token: p.token, prev: new Map(), stagger: p.stagger })), total)
  }

  // ─── Acciones de borrado: menú + modo "borrar días" + borrar período ───
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [deleteMode, setDeleteMode] = useState(false)

  // El tip "mantené pulsado" se oculta solo a los 5 s mientras está visible (la X lo descarta para
  // siempre; el auto-ocultado NO persiste, así puede volver a enseñar en próximas aperturas).
  useEffect(() => {
    if (!showCopyTip || loading || applySource || deleteMode) return
    const t = setTimeout(() => setShowCopyTip(false), 5000)
    return () => clearTimeout(t)
  }, [showCopyTip, loading, applySource, deleteMode])

  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set())
  const [confirmDeleteDias, setConfirmDeleteDias] = useState(false)
  const [deletePeriodoStep, setDeletePeriodoStep] = useState(0)  // 0 oculto · 1 primera confirmación · 2 segunda

  const [calAnimKey, setCalAnimKey] = useState(`${mes}-${anio}-init`)
  const [calAnimClass, setCalAnimClass] = useState('')

  const dias = useMemo(() => diasDelPeriodo(mes, anio), [mes, anio])

  const byDay = useMemo(() => {
    const m = new Map<string, RegistroHoras>()
    for (const r of registros) {
      const d = new Date(r.fechaMs)
      m.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, r)
    }
    return m
  }, [registros])

  const resumen = useMemo(() => calcularResumenPeriodo(registros, settings.lineaTrabajo), [registros, settings.lineaTrabajo])

  const selectedRegistro = useMemo(() => {
    if (!selectedDate) return undefined
    return byDay.get(`${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`)
  }, [selectedDate, byDay])

  // Registro del día anterior → para avisar si fue turno noche (horas ya contadas)
  const prevDayRegistro = useMemo(() => {
    if (!selectedDate) return undefined
    const p = new Date(selectedDate)
    p.setDate(p.getDate() - 1)
    return byDay.get(`${p.getFullYear()}-${p.getMonth()}-${p.getDate()}`)
  }, [selectedDate, byDay])

  // Último día con turno cargado (hasta 14 días atrás) → reloj sugerido para el día nuevo
  const lastWorkedRegistro = useMemo(() => {
    if (!selectedDate) return undefined
    for (let i = 1; i <= 14; i++) {
      const p = new Date(selectedDate)
      p.setDate(p.getDate() - i)
      const r = byDay.get(`${p.getFullYear()}-${p.getMonth()}-${p.getDate()}`)
      if (r && r.entradaInicioMs != null && r.salidaInicioMs != null) return r
    }
    return undefined
  }, [selectedDate, byDay])

  function cambiarMes(delta: number) {
    let m = mes + delta
    let a = anio
    if (m > 11) { m = 0; a++ }
    if (m < 0) { m = 11; a-- }
    setMes(m); setAnio(a)
    const dir = delta > 0 ? 'fwd' : 'bwd'
    setCalAnimKey(`${m}-${a}-${dir}`)
    setCalAnimClass(dir === 'fwd' ? 'animate-[cal-slide-right_220ms_ease_both]' : 'animate-[cal-slide-left_220ms_ease_both]')
  }

  function pulse(key: string) {
    setPulseKey(null)
    // requestAnimationFrame para que la animación se re-dispare en taps consecutivos
    requestAnimationFrame(() => {
      setPulseKey(key)
      setTimeout(() => setPulseKey(k => (k === key ? null : k)), 560)
    })
  }

  /** Pinta (mode 'add') o despinta (mode 'remove') un día destino. Sin escribir en DB todavía. */
  function paintDay(date: Date, mode: 'add' | 'remove') {
    const key = dayKey(date)
    if (key === applySourceKey) return  // nunca el día origen
    setPaintedKeys(prev => {
      if (mode === 'add' ? prev.has(key) : !prev.has(key)) return prev
      const next = new Set(prev)
      if (mode === 'add') next.add(key)
      else next.delete(key)
      return next
    })
    if (mode === 'add') pulse(key)
  }

  /** Tap de un día: en modo aplicar no hace nada (lo maneja el pintado); si no, abre el diálogo. */
  function handleDayTap(date: Date, rect?: DOMRect) {
    if (deleteMode) { toggleDeleteDay(date); return }
    if (applySource) return
    // Origen para el "container transform": centro de la celda tocada (el diálogo crece desde ahí).
    setDialogOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
    setSelectedDate(date)
  }

  function startApplyMode(sourceDate: Date) {
    const src = byDay.get(dayKey(sourceDate))
    if (!src) return
    setApplySource(src)
    setApplySourceKey(dayKey(sourceDate))
    setPaintedKeys(new Set())
    setConfirmApply(null)
  }

  function exitApplyMode() {
    setApplySource(null)
    setApplySourceKey(null)
    setPulseKey(null)
    setPaintedKeys(new Set())
    setConfirmCommit(null)
  }

  /** "Finalizar": si hay días pintados que ya tenían datos, pide confirmar; si no, escribe directo. */
  function finalizarApply() {
    const overwriteCount = [...paintedKeys].filter(k => byDay.has(k)).length
    if (overwriteCount > 0) { setConfirmCommit(overwriteCount); return }
    commitPaint()
  }

  /** Escribe en DB todos los días pintados (sobrescribe en su lugar si ya existían → sin duplicados). */
  async function commitPaint() {
    if (!applySource || paintedKeys.size === 0) { exitApplyMode(); return }
    const afectados = new Set(paintedKeys)  // capturar antes de limpiar (para animar la reescritura)
    const prevDatos = new Map([...afectados].map(k => [k, byDay.get(k)] as [string, RegistroHoras | undefined]))  // estado VIEJO
    const writes = [...paintedKeys].map(key => {
      const clone = cloneForDate(applySource, dateFromKey(key), settings.diagrama, settings.diagramaInicioMs)
      const existing = byDay.get(key)
      if (existing) clone.id = existing.id
      return clone
    })
    try {
      await db.transaction('rw', db.registros, async () => { await db.registros.bulkPut(writes) })
      await shadowBackup()
      await reload()
      triggerRewrite(afectados, prevDatos)
    } catch (e) {
      console.error('Error al aplicar los días:', e)
    }
    exitApplyMode()
  }

  function toggleViewMode() {
    const next = viewMode === 'calendar' ? 'list' : 'calendar'
    setViewMode(next)
    setCalAnimKey(`view-${next}-${Date.now()}`)
    setCalAnimClass('animate-[view-fade-in_180ms_ease_both]')
  }

  // Long-press / click derecho sobre un día CON datos → pregunta "¿Aplicar a otro día?"
  function openContext(date: Date) {
    if (applySource || deleteMode) return  // ya estamos en un modo de selección
    if (!byDay.has(dayKey(date))) return   // solo días que ya tienen datos cargados
    setConfirmApply(date)
  }

  // ─── Borrar ───
  function startDeleteMode() {
    setShowActionsMenu(false)
    setSelectedToDelete(new Set())
    setDeleteMode(true)
  }

  function exitDeleteMode() {
    setDeleteMode(false)
    setSelectedToDelete(new Set())
    setConfirmDeleteDias(false)
  }

  /** En modo borrar (vista lista), tocar un día con datos lo marca/desmarca. */
  function toggleDeleteDay(date: Date) {
    const key = dayKey(date)
    if (!byDay.has(key)) return  // solo días con datos
    const isAdding = !selectedToDelete.has(key)
    setSelectedToDelete(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (isAdding) pulse(key)  // pop rojo al seleccionar
  }

  /** Pinta (add) o despinta (remove) un día para borrar — sólo días con datos. Tocar o arrastrar (vista calendario). */
  function paintDeleteDay(date: Date, mode: 'add' | 'remove') {
    const key = dayKey(date)
    if (!byDay.has(key)) return  // solo días con datos
    setSelectedToDelete(prev => {
      if (mode === 'add' ? prev.has(key) : !prev.has(key)) return prev
      const next = new Set(prev)
      if (mode === 'add') next.add(key)
      else next.delete(key)
      return next
    })
    if (mode === 'add') pulse(key)
  }

  /** Borra los días seleccionados (segunda confirmación ya aceptada). */
  async function doBorrarDias() {
    const afectados = new Set(selectedToDelete)  // capturar antes de limpiar (para animar la reescritura)
    const prevDatos = new Map([...afectados].map(k => [k, byDay.get(k)] as [string, RegistroHoras | undefined]))  // estado VIEJO
    const ids = [...selectedToDelete]
      .map(k => byDay.get(k)?.id)
      .filter((id): id is string => !!id)
    if (ids.length) {
      try {
        await db.registros.bulkDelete(ids)
        await shadowBackup()
        await reload()
        triggerRewrite(afectados, prevDatos)
      } catch (e) {
        console.error('Error al borrar días:', e)
      }
    }
    exitDeleteMode()
  }

  /** Borra todos los registros del período actual (segunda confirmación ya aceptada). */
  async function doBorrarPeriodo() {
    // Todos los días CON datos vuelven al estado 0 girando a la VEZ (flip simultáneo, sin escalonar).
    const afectados = new Set(byDay.keys())
    const prevDatos = new Map([...afectados].map(k => [k, byDay.get(k)] as [string, RegistroHoras | undefined]))
    const ids = registros.map(r => r.id)
    if (ids.length) {
      try {
        await db.registros.bulkDelete(ids)
        await shadowBackup()
        await reload()
        triggerRewrite(afectados, prevDatos, false)  // false = todos giran simultáneamente
      } catch (e) {
        console.error('Error al borrar el período:', e)
      }
    }
    setDeletePeriodoStep(0)
  }

  async function runExport(fn: () => void | Promise<void>) {
    setShowExportMenu(false)
    setDownloading(true)
    try {
      await fn()
      registrarExportacion()
      // Marca para que el donador reaparezca en la PRÓXIMA apertura de la app (otra sesión).
      exportadoEnEstaSesion = true
      try { localStorage.setItem(`planilla-beggar-post-export:${idKeyRef.current}`, '1') } catch { /* ignore */ }
      setBeggarVisible(true)    // al exportar: el donador aparece ahora
      setBeggarKey(k => k + 1)  // remonta el donador para mostrarlo de nuevo
    } catch (e) {
      console.error('Error exportando Excel:', e)
      alert('Error al generar el Excel.')
    } finally {
      // mantener la animación visible un instante aunque la exportación sea instantánea
      setTimeout(() => setDownloading(false), 1100)
    }
  }

  const diagramaLabel = DIAGRAMAS.find(d => d.key === settings.diagrama)?.label ?? settings.diagrama

  const periodoStartStr = periodoStart(mes, anio).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  const periodoEndStr = periodoEnd(mes, anio).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  // Fecha de cobro = 4º día hábil del mes siguiente al cierre (ej. "lun 6 jul").
  const cobroStr = fechaCobro(mes, anio)
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/[.,]/g, '')

  return (
    <div className={`relative isolate h-[100dvh] ${viewMode === 'list' ? 'overflow-y-auto' : 'overflow-hidden'} bg-slate-900 pb-24`}>
      <BgBlobs />
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => cambiarMes(-1)} className="p-2 text-slate-400 active:text-white">‹</button>
          <div className="text-center">
            <div className="text-base font-bold text-white">{MESES_ES[mes]} {anio}</div>
            <div className="text-xs text-slate-500">{periodoStartStr} – {periodoEndStr} · cobro: {cobroStr}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              data-tour="hrs-menu"
              onClick={() => setShowActionsMenu(v => !v)}
              className="p-2 text-slate-400 active:text-white"
              title="Más acciones"
            >
              <MoreVertical size={18} />
            </button>
            <button
              onClick={() => toggleViewMode()}
              className="p-2 text-slate-400 active:text-white"
              title={viewMode === 'calendar' ? 'Ver lista' : 'Ver calendario'}
            >
              {viewMode === 'calendar' ? <List size={18} /> : <LayoutGrid size={18} />}
            </button>
            <button onClick={() => cambiarMes(1)} className="p-2 text-slate-400 active:text-white">›</button>
          </div>
        </div>
      </div>

      {/* Resumen */}
      {!loading && <ResumenBar resumen={resumen} francosDisponibles={francosDisponibles} />}

      {/* Tip: copiar datos de un día a otro (mantener pulsado) — se auto-oculta a los 5 s */}
      {!loading && !applySource && !deleteMode && showCopyTip && (
        <div className="mx-4 mb-2 rounded-xl bg-sky-950/50 border border-sky-800/40 overflow-hidden animate-[apply-bar-in_220ms_ease_both]">
          <div className="flex items-center gap-2 px-3 py-2">
            <Lightbulb size={15} className="text-sky-400 shrink-0" />
            <span className="text-xs text-sky-200/90 flex-1 leading-snug">
              Mantené pulsado un día para copiar sus datos a otro.
            </span>
            <button onClick={dismissCopyTip} className="text-sky-500 active:text-sky-300 shrink-0" aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>
          {/* Barra de tiempo: se oculta solo a los 5 s */}
          <div className="h-0.5 bg-sky-500/15">
            <div className="h-full bg-sky-400/70 animate-[countdown-bar_5s_linear_forwards]" />
          </div>
        </div>
      )}

      {/* Day view */}
      {loading ? (
        // Skeleton del calendario (sólo en el 1er load): grilla de celdas con pulso escalonado.
        <div className="px-2 pb-2">
          <div className="grid grid-cols-7 mb-1">
            {Array.from({ length: 7 }).map((_, i) => <div key={i} className="mx-auto my-1.5 h-2 w-5 rounded bg-slate-700/50" />)}
          </div>
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, r) => (
              <div key={r} className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }).map((_, c) => (
                  <div key={c} className="aspect-square sm:aspect-auto sm:h-[clamp(2.5rem,8vh,4.25rem)] rounded-lg bg-slate-800/70 animate-pulse" style={{ animationDelay: `${(r * 7 + c) * 22}ms` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          key={calAnimKey}
          className={calAnimClass}
        >
          {viewMode === 'calendar' ? (
            <CalendarGrid
              dias={dias}
              byDay={byDay}
              diagrama={settings.diagrama}
              diagramaInicioMs={settings.diagramaInicioMs}
              onSelectDate={handleDayTap}
              onContext={openContext}
              applyMode={!!applySource}
              sourceKey={applySourceKey}
              paintedKeys={paintedKeys}
              onPaint={paintDay}
              pulseKey={pulseKey}
              deleteMode={deleteMode}
              selectedDeleteKeys={selectedToDelete}
              onDeletePaint={paintDeleteDay}
              lineaTrabajo={settings.lineaTrabajo}
              rewriteKeys={rewrite.keys}
              rewriteToken={rewrite.token}
              rewritePrev={rewrite.prev}
              rewriteStagger={rewrite.stagger}
            />
          ) : (
            <div className="px-4 space-y-1.5">
              {dias.map(d => {
                const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
                return (
                  <DayCard
                    key={key}
                    fecha={d}
                    registro={byDay.get(key)}
                    diagrama={settings.diagrama}
                    diagramaInicioMs={settings.diagramaInicioMs}
                    onClick={() => handleDayTap(d)}
                    onContext={openContext}
                    deleteMode={deleteMode}
                    selectedForDelete={deleteMode && selectedToDelete.has(key)}
                    lineaTrabajo={settings.lineaTrabajo}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Export FAB — above the bottom nav (z-30, ~52px); oculto en modo aplicar */}
      <div className={`fixed bottom-20 right-4 z-40 flex flex-col items-end ${applySource || deleteMode ? 'hidden' : ''}`}>
        {showExportMenu && (
          <div className="mb-2 flex flex-col gap-2 items-end">
            <button
              data-tour="hrs-export-normal"
              onClick={() => runExport(() =>
                exportarExcelNormal(mes, anio, registros, settings.nombreUsuario, diagramaLabel, settings.diagrama, settings.diagramaInicioMs)
              )}
              className="bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg whitespace-nowrap flex items-center gap-2 animate-[fab-item-in_180ms_ease_both]"
            >
              <FileText size={15} /> Normal (planilla)
            </button>
            <button
              onClick={() => runExport(() => exportarExcelCompleto(mes, anio, registros, settings.nombreUsuario, settings.lineaTrabajo))}
              className="bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg whitespace-nowrap flex items-center gap-2 animate-[fab-item-in_180ms_ease_both]"
              style={{ animationDelay: '40ms' }}
            >
              <FileBarChart size={15} /> Completo con horas
            </button>
          </div>
        )}
        <button
          data-tour="hrs-export"
          onClick={() => !downloading && setShowExportMenu(v => !v)}
          disabled={downloading}
          className={`w-14 h-14 rounded-full text-white text-2xl shadow-xl flex items-center justify-center active:scale-95 transition-all duration-200 ${downloading ? 'bg-emerald-600' : 'bg-blue-600'}`}
        >
          <span
            className="inline-flex transition-transform duration-300"
            style={{ transform: showExportMenu ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            {downloading
              ? <Download size={22} className="animate-[fab-download-bounce_700ms_ease-in-out_infinite]" />
              : showExportMenu ? <X size={22} /> : <Upload size={22} />}
          </span>
        </button>
      </div>

      {/* Donador — pedido de donación. Aparece sólo si el admin lo ACTIVÓ globalmente (beggarActivo,
          apagado por defecto) O si esta identidad está en la whitelist de desbloqueo (esBeggarUnlock,
          vista previa para el admin aunque esté apagado para todos). O agradecimiento al volver de
          donar (>1 min). Si donó en las últimas 24 h, no aparece. */}
      {(beggarActivo || esBeggarUnlock(settings.nombreUsuario)) && (graciasVisible
        ? <DonadorGracias onDone={() => setGraciasVisible(false)} />
        : (!yaAgradecioHoy && beggarVisible && <DonadorDonacion key={beggarKey} idKey={idKey} />))}

      {/* Registro dialog */}
      {selectedDate && (
        <RegistroDialog
          fecha={selectedDate}
          existing={selectedRegistro}
          prevDayRegistro={prevDayRegistro}
          lastWorkedRegistro={lastWorkedRegistro}
          proyectosFrecuentes={settings.proyectosFrecuentes}
          diagrama={settings.diagrama}
          diagramaInicioMs={settings.diagramaInicioMs}
          francosDisponibles={francosDisponibles}
          origin={dialogOrigin}
          guardarSiempreAlSalir={settings.guardarSiempreAlSalir}
          onSetGuardarSiempre={(v) => update({ guardarSiempreAlSalir: v })}
          onSave={async (reg) => { await upsert(reg); setSelectedDate(null) }}
          onDelete={async (id) => { await remove(id); setSelectedDate(null) }}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {/* Overlay dismiss export menu */}
      {showExportMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
      )}

      {/* Menú de acciones (borrar) */}
      {showActionsMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowActionsMenu(false)} />
          <div className="fixed top-16 right-3 z-50 w-56 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl overflow-hidden animate-[view-fade-in_120ms_ease_both]">
            <button
              onClick={() => { setShowActionsMenu(false); setDeletePeriodoStep(1) }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-300 active:bg-slate-700/60"
            >
              <Trash2 size={16} className="shrink-0" /> Borrar período actual
            </button>
            <div className="h-px bg-slate-700/70" />
            <button
              data-tour="menu-borrar-dias"
              onClick={startDeleteMode}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-300 active:bg-slate-700/60"
            >
              <CalendarX2 size={16} className="shrink-0" /> Borrar días (elegir)…
            </button>
            <div className="h-px bg-slate-700/70" />
            <button
              onClick={() => { setShowActionsMenu(false); onAbrirTutorial?.() }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-sky-300 active:bg-slate-700/60"
            >
              <Lightbulb size={16} className="shrink-0" /> Ver tutorial
            </button>
          </div>
        </>
      )}

      {/* ─── Modo aplicar: barra superior (cubre el header mientras se aplica) ─── */}
      {applySource && (
        <div className="fixed top-0 inset-x-0 z-50 bg-sky-950/95 backdrop-blur border-b border-sky-700 shadow-lg animate-[apply-bar-in_180ms_ease_both]">
          <div className="px-4 py-3">
            <div className="flex items-start gap-3">
              <Copy size={18} className="text-sky-300 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white leading-snug">
                  Pintá los días a llenar: tocá o arrastrá el dedo. Tocá de nuevo para despintar.
                </div>
                <div className="text-xs text-sky-300/90 mt-0.5">
                  {paintedKeys.size > 0
                    ? `${paintedKeys.size} día${paintedKeys.size === 1 ? '' : 's'} pintado${paintedKeys.size === 1 ? '' : 's'}`
                    : `Origen: ${new Date(applySource.fechaMs).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}`}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={exitApplyMode}
                className="flex-1 py-2 rounded-xl bg-slate-700 text-white text-sm font-medium active:scale-95 transition-transform flex items-center justify-center gap-1.5"
              >
                <X size={15} /> Cancelar
              </button>
              <button
                onClick={finalizarApply}
                disabled={paintedKeys.size === 0}
                className="flex-1 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold active:scale-95 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:active:scale-100"
              >
                <Check size={15} /> Aplicar ({paintedKeys.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación: ¿aplicar este día a otros? */}
      {confirmApply && (
        <ConfirmModal
          title="¿Aplicar a otro día?"
          message="Vas a copiar las horas y la observación de este día a otros días que elijas en el calendario."
          confirmLabel="Sí, elegir días"
          onConfirm={() => startApplyMode(confirmApply)}
          onCancel={() => setConfirmApply(null)}
        />
      )}

      {/* Confirmación: algunos días pintados ya tienen datos guardados */}
      {confirmCommit !== null && (
        <ConfirmModal
          title="Algunos días ya tienen datos"
          message={`${confirmCommit} de los días pintados ya ${confirmCommit === 1 ? 'tiene datos guardados' : 'tienen datos guardados'}. ¿Querés reemplazar${confirmCommit === 1 ? 'los' : 'los'} con los del día origen?`}
          confirmLabel="Reemplazar y aplicar"
          danger
          onConfirm={() => { setConfirmCommit(null); commitPaint() }}
          onCancel={() => setConfirmCommit(null)}
        />
      )}

      {/* ─── Modo borrar días: barra superior (tocar días a borrar) ─── */}
      {deleteMode && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-950/95 backdrop-blur border-b border-red-800 shadow-lg animate-[apply-bar-in_180ms_ease_both]">
          <div className="px-4 py-3">
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="text-red-300 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white leading-snug">
                  Tocá o arrastrá los días que querés borrar
                </div>
                <div className="text-xs text-red-300/90 mt-0.5">
                  {selectedToDelete.size > 0
                    ? `${selectedToDelete.size} día${selectedToDelete.size === 1 ? '' : 's'} seleccionado${selectedToDelete.size === 1 ? '' : 's'}`
                    : 'Tocá o arrastrá; sólo días con datos cargados'}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={exitDeleteMode}
                className="flex-1 py-2 rounded-xl bg-slate-700 text-white text-sm font-medium active:scale-95 transition-transform flex items-center justify-center gap-1.5"
              >
                <X size={15} /> Cancelar
              </button>
              <button
                onClick={() => setConfirmDeleteDias(true)}
                disabled={selectedToDelete.size === 0}
                className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold active:scale-95 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:active:scale-100"
              >
                <Trash2 size={15} /> Borrar ({selectedToDelete.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Borrar días: confirmación final (segunda confirmación) */}
      {confirmDeleteDias && (
        <ConfirmModal
          title="¿Borrar los días seleccionados?"
          message={`Se eliminarán ${selectedToDelete.size} día${selectedToDelete.size === 1 ? '' : 's'} del período. Esta acción no se puede deshacer.`}
          confirmLabel="Borrar"
          danger
          onConfirm={doBorrarDias}
          onCancel={() => setConfirmDeleteDias(false)}
        />
      )}

      {/* Borrar período: doble confirmación */}
      {deletePeriodoStep === 1 && (
        <ConfirmModal
          title="¿Borrar el período actual?"
          message={`Vas a eliminar ${registros.length} registro${registros.length === 1 ? '' : 's'} de ${MESES_ES[mes]} ${anio} (${periodoStartStr} – ${periodoEndStr}).`}
          confirmLabel="Continuar"
          onConfirm={() => setDeletePeriodoStep(2)}
          onCancel={() => setDeletePeriodoStep(0)}
        />
      )}
      {deletePeriodoStep === 2 && (
        <ConfirmModal
          title="Confirmar borrado"
          message="Esta acción no se puede deshacer. ¿Seguro que querés borrar todo el período?"
          confirmLabel="Borrar todo"
          danger
          onConfirm={doBorrarPeriodo}
          onCancel={() => setDeletePeriodoStep(0)}
        />
      )}
    </div>
  )
}

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({ title, message, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-[backdrop-fade-in_150ms_ease_both]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs bg-slate-800 border border-slate-600/70 rounded-2xl shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-white">{title}</h3>
        <p className="text-sm text-slate-300 mt-1.5 leading-snug">{message}</p>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-medium active:scale-95 transition-transform"
          >
            {danger ? 'No' : 'Cancelar'}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold active:scale-95 transition-transform ${danger ? 'bg-orange-600' : 'bg-sky-600'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
