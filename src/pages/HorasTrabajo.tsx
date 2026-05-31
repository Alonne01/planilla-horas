import { useState, useMemo, useRef } from 'react'
import { FileText, FileBarChart, Upload, X, LayoutGrid, List, Copy, Check, Lightbulb } from 'lucide-react'
import { useHoras, useFrancoCounter } from '../hooks/useHoras'
import { useSettings } from '../hooks/useSettings'
import { RegistroDialog } from '../components/RegistroDialog'
import { DayCard } from '../components/DayCard'
import { CalendarGrid } from '../components/CalendarGrid'
import { ResumenBar } from '../components/ResumenBar'
import { calcularResumenPeriodo } from '../lib/calculo-horas'
import { defaultPeriodoMes, defaultPeriodoAnio, diasDelPeriodo, MESES_ES, DIAGRAMAS, periodoStart, periodoEnd, esFrancoPorDiagrama, type DiagramaPatternKey } from '../lib/diagrama'
import { esFeriadoNacional } from '../lib/feriados'
import { exportarExcelNormal } from '../lib/excel-export'
import { exportarExcelCompleto } from '../lib/excel-export-full'
import { db, shadowBackup, type RegistroHoras } from '../db/database'

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
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
  }
}

export function HorasTrabajoPage() {
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const { registros, loading, upsert, remove, reload } = useHoras(mes, anio)
  const { settings } = useSettings()
  const francosDisponibles = useFrancoCounter()

  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const [showCopyTip, setShowCopyTip] = useState(() => {
    try { return localStorage.getItem('planilla-tip-copiar') !== 'dismissed' } catch { return true }
  })

  function dismissCopyTip() {
    setShowCopyTip(false)
    try { localStorage.setItem('planilla-tip-copiar', 'dismissed') } catch { /* ignore */ }
  }

  // ─── Modo "aplicar datos a otro día" (reemplaza copiar día anterior / copiar a días hábiles) ───
  const [applySource, setApplySource] = useState<RegistroHoras | null>(null)
  const [applySourceKey, setApplySourceKey] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState<Date | null>(null)      // pregunta "¿Aplicar a otro día?"
  const [confirmReplace, setConfirmReplace] = useState<Date | null>(null)  // pregunta "¿Reemplazar?"
  const [pulseKey, setPulseKey] = useState<string | null>(null)
  const [appliedCount, setAppliedCount] = useState(0)
  const applySnapshotRef = useRef<RegistroHoras[]>([])  // snapshot del período al entrar al modo aplicar (para Cancelar)

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

  const resumen = useMemo(() => calcularResumenPeriodo(registros), [registros])

  const selectedRegistro = useMemo(() => {
    if (!selectedDate) return undefined
    return byDay.get(`${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`)
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
      setTimeout(() => setPulseKey(k => (k === key ? null : k)), 480)
    })
  }

  /** Aplica los datos del día origen a `target` (sobrescribe en su lugar si ya existía). */
  async function doApply(target: Date) {
    if (!applySource) return
    const key = dayKey(target)
    const existing = byDay.get(key)
    const clone = cloneForDate(applySource, target, settings.diagrama, settings.diagramaInicioMs)
    if (existing) clone.id = existing.id  // sobrescribir en su lugar → sin duplicados
    await upsert(clone)
    setAppliedCount(c => c + 1)
    pulse(key)
  }

  /** Tap de un día: en modo aplicar copia los datos; si no, abre el diálogo de registro. */
  function handleDayTap(date: Date) {
    if (!applySource) { setSelectedDate(date); return }
    const key = dayKey(date)
    if (key === applySourceKey) return                       // no aplicar sobre sí mismo
    if (byDay.has(key)) { setConfirmReplace(date); return }   // ya tiene datos → preguntar
    doApply(date)
  }

  function startApplyMode(sourceDate: Date) {
    const src = byDay.get(dayKey(sourceDate))
    if (!src) return
    applySnapshotRef.current = registros  // snapshot del período para poder deshacer con "Cancelar"
    setApplySource(src)
    setApplySourceKey(dayKey(sourceDate))
    setAppliedCount(0)
    setConfirmApply(null)
  }

  function exitApplyMode() {
    setApplySource(null)
    setApplySourceKey(null)
    setPulseKey(null)
    setAppliedCount(0)
    setConfirmReplace(null)
  }

  // "Cancelar": deshace lo aplicado en esta sesión restaurando el snapshot del período.
  async function cancelApplyMode() {
    if (appliedCount > 0) {
      const snap = applySnapshotRef.current
      const snapIds = new Set(snap.map(r => r.id))
      const toDelete = registros.filter(r => !snapIds.has(r.id)).map(r => r.id)
      try {
        await db.transaction('rw', db.registros, async () => {
          if (toDelete.length) await db.registros.bulkDelete(toDelete)
          if (snap.length) await db.registros.bulkPut(snap)
        })
        await shadowBackup()
        await reload()
      } catch (e) {
        console.error('Error al deshacer la aplicación:', e)
      }
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
    if (applySource) return               // ya estamos en modo aplicar
    if (!byDay.has(dayKey(date))) return  // solo días que ya tienen datos cargados
    setConfirmApply(date)
  }

  const diagramaLabel = DIAGRAMAS.find(d => d.key === settings.diagrama)?.label ?? settings.diagrama

  const periodoStartStr = periodoStart(mes, anio).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  const periodoEndStr = periodoEnd(mes, anio).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => cambiarMes(-1)} className="p-2 text-slate-400 active:text-white">‹</button>
          <div className="text-center">
            <div className="text-base font-bold text-white">{MESES_ES[mes]} {anio}</div>
            <div className="text-xs text-slate-500">{periodoStartStr} – {periodoEndStr}</div>
          </div>
          <div className="flex items-center gap-1">
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

      {/* Tip: copiar datos de un día a otro (mantener pulsado) */}
      {!loading && !applySource && showCopyTip && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-sky-950/50 border border-sky-800/40 px-3 py-2 animate-[apply-bar-in_220ms_ease_both]">
          <Lightbulb size={15} className="text-sky-400 shrink-0" />
          <span className="text-xs text-sky-200/90 flex-1 leading-snug">
            Mantené pulsado un día para copiar sus datos a otro.
          </span>
          <button onClick={dismissCopyTip} className="text-sky-500 active:text-sky-300 shrink-0" aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Day view */}
      {loading ? (
        <div className="text-center text-slate-500 py-12">Cargando…</div>
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
              pulseKey={pulseKey}
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
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Export FAB — above the bottom nav (z-30, ~52px); oculto en modo aplicar */}
      <div className={`fixed bottom-20 right-4 z-40 ${applySource ? 'hidden' : ''}`}>
        {showExportMenu && (
          <div className="mb-2 flex flex-col gap-2 items-end">
            <button
              onClick={() => {
                exportarExcelNormal(mes, anio, registros, settings.nombreUsuario, diagramaLabel, settings.diagrama, settings.diagramaInicioMs)
                  .catch(e => { console.error('Error exportando Excel:', e); alert('Error al generar el Excel.') })
                setShowExportMenu(false)
              }}
              className="bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg whitespace-nowrap flex items-center gap-2"
            >
              <FileText size={15} /> Normal (planilla)
            </button>
            <button
              onClick={() => {
                exportarExcelCompleto(mes, anio, registros, settings.nombreUsuario)
                setShowExportMenu(false)
              }}
              className="bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg whitespace-nowrap flex items-center gap-2"
            >
              <FileBarChart size={15} /> Completo con horas
            </button>
          </div>
        )}
        <button
          onClick={() => setShowExportMenu(v => !v)}
          className="w-14 h-14 rounded-full bg-blue-600 text-white text-2xl shadow-xl flex items-center justify-center active:scale-95 transition-transform"
        >
          {showExportMenu ? <X size={22} /> : <Upload size={22} />}
        </button>
      </div>

      {/* Registro dialog */}
      {selectedDate && (
        <RegistroDialog
          fecha={selectedDate}
          existing={selectedRegistro}
          proyectosFrecuentes={settings.proyectosFrecuentes}
          diagrama={settings.diagrama}
          diagramaInicioMs={settings.diagramaInicioMs}
          onSave={async (reg) => { await upsert(reg); setSelectedDate(null) }}
          onDelete={async (id) => { await remove(id); setSelectedDate(null) }}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {/* Overlay dismiss export menu */}
      {showExportMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
      )}

      {/* ─── Modo aplicar: barra superior (cubre el header mientras se aplica) ─── */}
      {applySource && (
        <div className="fixed top-0 inset-x-0 z-50 bg-sky-950/95 backdrop-blur border-b border-sky-700 shadow-lg animate-[apply-bar-in_180ms_ease_both]">
          <div className="px-4 py-3">
            <div className="flex items-start gap-3">
              <Copy size={18} className="text-sky-300 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white leading-snug">
                  Tocá los días que quieras llenar con los datos de este día
                </div>
                <div className="text-xs text-sky-300/90 mt-0.5">
                  {appliedCount > 0
                    ? `${appliedCount} día${appliedCount === 1 ? '' : 's'} aplicado${appliedCount === 1 ? '' : 's'}`
                    : `Origen: ${new Date(applySource.fechaMs).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}`}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={cancelApplyMode}
                className="flex-1 py-2 rounded-xl bg-slate-700 text-white text-sm font-medium active:scale-95 transition-transform flex items-center justify-center gap-1.5"
              >
                <X size={15} /> Cancelar
              </button>
              <button
                onClick={exitApplyMode}
                className="flex-1 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold active:scale-95 transition-transform flex items-center justify-center gap-1.5"
              >
                <Check size={15} /> Finalizar
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

      {/* Confirmación: el día destino ya tiene datos */}
      {confirmReplace && (
        <ConfirmModal
          title="Ese día ya tiene datos"
          message="¿Querés reemplazarlos con los datos del día origen?"
          confirmLabel="Reemplazar"
          danger
          onConfirm={() => { const d = confirmReplace; setConfirmReplace(null); doApply(d) }}
          onCancel={() => setConfirmReplace(null)}
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
