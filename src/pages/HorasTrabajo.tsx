import { useState, useMemo } from 'react'
import { FileText, FileBarChart, Upload, X, LayoutGrid, List } from 'lucide-react'
import { useHoras, useFrancoCounter } from '../hooks/useHoras'
import { useSettings } from '../hooks/useSettings'
import { RegistroDialog } from '../components/RegistroDialog'
import { DayCard } from '../components/DayCard'
import { CalendarGrid } from '../components/CalendarGrid'
import { ResumenBar } from '../components/ResumenBar'
import { calcularResumenPeriodo } from '../lib/calculo-horas'
import { defaultPeriodoMes, defaultPeriodoAnio, diasDelPeriodo, MESES_ES, DIAGRAMAS, periodoStart, periodoEnd } from '../lib/diagrama'
import { exportarExcelNormal } from '../lib/excel-export'
import { exportarExcelCompleto } from '../lib/excel-export-full'
import type { RegistroHoras } from '../db/database'

export function HorasTrabajoPage() {
  const [mes, setMes] = useState(defaultPeriodoMes())
  const [anio, setAnio] = useState(defaultPeriodoAnio())
  const { registros, loading, upsert, remove } = useHoras(mes, anio)
  const { settings } = useSettings()
  const francosDisponibles = useFrancoCounter()

  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')

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
              onClick={() => setViewMode(v => v === 'calendar' ? 'list' : 'calendar')}
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

      {/* Day view */}
      {loading ? (
        <div className="text-center text-slate-500 py-12">Cargando…</div>
      ) : viewMode === 'calendar' ? (
        <CalendarGrid
          dias={dias}
          byDay={byDay}
          diagrama={settings.diagrama}
          diagramaInicioMs={settings.diagramaInicioMs}
          onSelectDate={setSelectedDate}
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
                onClick={() => setSelectedDate(d)}
              />
            )
          })}
        </div>
      )}

      {/* Export FAB — above the bottom nav (z-30, ~52px) */}
      <div className="fixed bottom-20 right-4 z-40">
        {showExportMenu && (
          <div className="mb-2 flex flex-col gap-2 items-end">
            <button
              onClick={() => {
                exportarExcelNormal(mes, anio, registros, settings.nombreUsuario, diagramaLabel)
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
    </div>
  )
}
