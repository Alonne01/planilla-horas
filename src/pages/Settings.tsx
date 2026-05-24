import { useState, useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'
import { DIAGRAMAS } from '../lib/diagrama'
import { exportBackupJSON, importBackupJSON, msSinceLastBackup, markBackupDone } from '../db/database'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function SettingsPage() {
  const { settings, update, loaded } = useSettings()
  const [msg, setMsg] = useState('')
  const [backupOverdue, setBackupOverdue] = useState(false)

  useEffect(() => {
    setBackupOverdue(msSinceLastBackup() > SEVEN_DAYS_MS)
  }, [])

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function handleExportBackup() {
    const json = await exportBackupJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `planilla-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click(); URL.revokeObjectURL(url)
    markBackupDone()
    setBackupOverdue(false)
    flash('Backup exportado ✓')
  }

  async function handleImportBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      await importBackupJSON(text)
      flash('Backup importado ✓')
    } catch {
      flash('Error: archivo inválido')
    }
    e.target.value = ''
  }

  if (!loaded) return <div className="text-center text-slate-500 py-12">Cargando…</div>

  return (
    <div className="min-h-screen bg-slate-900 pb-12">
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-4">
        <h1 className="text-lg font-bold text-white">Configuración</h1>
      </div>

      {msg && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-900/40 text-emerald-300 text-sm">{msg}</div>
      )}

      {backupOverdue && !msg && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-900/40 text-amber-300 text-sm flex items-start gap-2">
          <span className="text-lg leading-none">⚠️</span>
          <span>Hace más de 7 días que no exportás un backup. Recomendamos hacerlo ahora.</span>
        </div>
      )}

      <div className="px-4 py-4 space-y-6">
        {/* Nombre */}
        <Section title="Empleado">
          <Field label="Nombre completo">
            <input
              type="text"
              value={settings.nombreUsuario}
              onChange={e => update({ nombreUsuario: e.target.value })}
              className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm"
              placeholder="Ej: García Martín"
            />
          </Field>
        </Section>

        {/* Diagrama */}
        <Section title="Diagrama de trabajo">
          <div className="grid grid-cols-2 gap-2">
            {DIAGRAMAS.map(d => (
              <button
                key={d.key}
                onClick={() => update({ diagrama: d.key })}
                className={`py-3 px-4 rounded-xl text-sm font-medium text-left transition-colors ${settings.diagrama === d.key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                <div className="font-bold">{d.label}</div>
                <div className="text-xs opacity-70 mt-0.5">{d.diasTrabajo} trabajo · {d.diasFranco} franco</div>
              </button>
            ))}
          </div>

          {settings.diagrama !== 'LUNES_VIERNES' && (
            <Field label="Fecha inicio de diagrama">
              <input
                type="date"
                value={settings.diagramaInicioMs ? new Date(settings.diagramaInicioMs).toISOString().slice(0, 10) : ''}
                onChange={e => update({ diagramaInicioMs: e.target.value ? new Date(e.target.value).getTime() : 0 })}
                className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm"
              />
            </Field>
          )}
        </Section>

        {/* Proyectos frecuentes */}
        <Section title="Proyectos frecuentes">
          <ProyectosEditor
            proyectos={settings.proyectosFrecuentes}
            onChange={proyectosFrecuentes => update({ proyectosFrecuentes })}
          />
        </Section>

        {/* Backup */}
        <Section title="Datos y backup">
          <div className="space-y-2">
            <button onClick={handleExportBackup}
              className="w-full py-3 rounded-xl bg-slate-700 text-slate-200 text-sm font-medium">
              💾 Exportar backup JSON
            </button>
            <label className="block">
              <span className="w-full py-3 rounded-xl bg-slate-700 text-slate-200 text-sm font-medium flex items-center justify-center cursor-pointer">
                📂 Importar backup JSON
              </span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
            <p className="text-xs text-slate-500 px-1">
              Importar reemplaza TODOS los datos actuales.
            </p>
          </div>
        </Section>

        {/* Advertencia de almacenamiento */}
        <StorageWarningBanner />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase text-slate-500 mb-3 tracking-wider">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function StorageWarningBanner() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-lg">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-300">Consideraciones sobre tus datos</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            Almacenamiento local · Sin sincronización entre dispositivos
          </p>
        </div>
        <span className="text-slate-500 text-xs ml-2">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-amber-500/20">
          {/* Cómo se guardan */}
          <div className="pt-3">
            <p className="text-xs font-bold uppercase text-amber-400/70 tracking-wider mb-2">
              Cómo se guardan los datos
            </p>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex gap-2">
                <span className="text-amber-400 mt-0.5 shrink-0">•</span>
                <span><strong className="text-slate-200">Copia principal</strong> — IndexedDB en tu navegador/dispositivo.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-400 mt-0.5 shrink-0">•</span>
                <span><strong className="text-slate-200">Copia sombra automática</strong> — respaldo en localStorage, actualizado en cada cambio.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-400 mt-0.5 shrink-0">•</span>
                <span>Ambas copias son <strong className="text-slate-200">locales</strong>; no existe servidor ni sincronización externa.</span>
              </li>
            </ul>
          </div>

          {/* Escenarios de posible pérdida */}
          <div>
            <p className="text-xs font-bold uppercase text-red-400/70 tracking-wider mb-2">
              Escenarios de posible pérdida
            </p>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex gap-2">
                <span className="text-red-400 mt-0.5 shrink-0">!</span>
                <span><strong className="text-slate-200">"Borrar datos del sitio"</strong> en el navegador borra ambas copias simultáneamente.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-400 mt-0.5 shrink-0">!</span>
                <span><strong className="text-slate-200">iOS Safari</strong>: si la app no se abre por 7+ días y el dispositivo tiene poco espacio, iOS puede eliminar automáticamente todo el almacenamiento del origen.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-400 mt-0.5 shrink-0">!</span>
                <span><strong className="text-slate-200">Modo privado/incógnito</strong>: los datos se eliminan al cerrar el navegador.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-400 mt-0.5 shrink-0">!</span>
                <span><strong className="text-slate-200">Reset de fábrica o cambio de dispositivo</strong>: los datos no se migran automáticamente.</span>
              </li>
            </ul>
          </div>

          {/* Limitaciones */}
          <div>
            <p className="text-xs font-bold uppercase text-slate-400/70 tracking-wider mb-2">
              Limitaciones actuales
            </p>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex gap-2">
                <span className="text-slate-500 mt-0.5 shrink-0">–</span>
                <span>Sin sincronización entre dispositivos.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-slate-500 mt-0.5 shrink-0">–</span>
                <span>Sin recuperación automática ante limpieza total del navegador.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-slate-500 mt-0.5 shrink-0">–</span>
                <span>Cuota de almacenamiento limitada por el navegador (~5 MB localStorage). El uso real estimado es &lt;200 KB/año, dentro del límite.</span>
              </li>
            </ul>
          </div>

          {/* Recomendaciones */}
          <div className="bg-green-900/20 border border-green-500/25 rounded-xl px-3 py-2.5">
            <p className="text-xs font-bold uppercase text-green-400/70 tracking-wider mb-2">
              Recomendaciones
            </p>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex gap-2">
                <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                <span>Exportar backup JSON cada 7 días y guardarlo en Google Drive, iCloud u otra nube.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                <span>Instalar la app desde "Agregar a pantalla de inicio" para mayor persistencia en iOS.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                <span>No usar en modo privado/incógnito.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                <span>Abrir la app al menos una vez por semana en iOS.</span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function ProyectosEditor({ proyectos, onChange }: { proyectos: string[]; onChange: (p: string[]) => void }) {
  const [input, setInput] = useState('')

  function add() {
    const v = input.trim()
    if (!v || proyectos.includes(v)) return
    onChange([...proyectos, v])
    setInput('')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Nombre del proyecto…"
          className="flex-1 bg-slate-700 text-white rounded-xl px-3 py-2 text-sm"
        />
        <button onClick={add} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold">+</button>
      </div>
      <div className="space-y-1">
        {proyectos.map(p => (
          <div key={p} className="flex items-center justify-between bg-slate-700/50 rounded-xl px-3 py-2">
            <span className="text-sm text-slate-200">{p}</span>
            <button onClick={() => onChange(proyectos.filter(x => x !== p))} className="text-slate-500 hover:text-red-400 text-lg leading-none">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
