import { useState, useEffect, useRef } from "react"
import { Clock, Settings2, Banknote, BarChart3, RefreshCw, AlertTriangle, Download, FolderOpen, X } from "lucide-react"
import { HorasTrabajoPage } from "./pages/HorasTrabajo"
import { SettingsPage } from "./pages/Settings"
import { AnalyticsPage } from "./pages/Analytics"
import { ProyeccionSalarialPage } from "./pages/ProyeccionSalarial"
import { InstallGate } from "./components/InstallGate"
import { restoreFromShadow, db, exportBackupJSON, importBackupJSON, msSinceAutoBackup, markAutoBackupDone, pruneOldRegistros, migrateHorasViaje } from "./db/database"
import { useSettings } from "./hooks/useSettings"
import "./index.css"

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
}

const SHOW_SALARY = import.meta.env.VITE_SHOW_SALARY === "true"
const AUTO_BACKUP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000 // 2 days

type Tab = "horas" | "analytics" | "settings" | "salary"
const TAB_ORDER: Tab[] = ["horas", "analytics", "settings", "salary"]

function goToTab(next: Tab, current: Tab, setter: (t: Tab) => void) {
  if (next === current) return
  const isBack = TAB_ORDER.indexOf(next) < TAB_ORDER.indexOf(current)
  if ("startViewTransition" in document) {
    if (isBack) document.documentElement.classList.add("vt-back")
    else document.documentElement.classList.remove("vt-back")
    const t = (document as any).startViewTransition(() => setter(next))
    t.finished?.then(() => document.documentElement.classList.remove("vt-back"))
               ?.catch(() => document.documentElement.classList.remove("vt-back"))
  } else {
    setter(next)
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("horas")
  const [recovered, setRecovered] = useState(false)
  const [persistDenied, setPersistDenied] = useState(false)
  const [autoBackupDue, setAutoBackupDue] = useState(false)
  const [autoBackupDone, setAutoBackupDone] = useState(false)
  const [emptyDb, setEmptyDb] = useState(false)
  const [gateSkipped, setGateSkipped] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)

  // iOS Safari can silently erase PWA storage after 7 days of inactivity
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOSBrowser = (/iphone|ipad|ipod/i.test(ua) ||
    (ua.includes('Mac') && 'ontouchend' in document)) &&
    !window.matchMedia('(display-mode: standalone)').matches

  useEffect(() => {
    async function init() {
      const didRecover = await restoreFromShadow()
      if (didRecover) setRecovered(true)

      // Silently prune records older than 6 months
      try { await pruneOldRegistros() } catch { /* non-fatal */ }

      // Migrate old horasViaje=1 (boolean) to horasViaje=2 (hours)
      try { await migrateHorasViaje() } catch { /* non-fatal */ }

      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist()
        if (!granted) setPersistDenied(true)
      }

      // Check record count after shadow restore
      try {
        const count = await db.registros.count()
        if (count === 0 && !didRecover) {
          setEmptyDb(true)
        } else if (count > 0 && msSinceAutoBackup() > AUTO_BACKUP_INTERVAL_MS) {
          setAutoBackupDue(true)
        }
      } catch {
        // non-fatal
      }
    }
    init()
  }, [])

  // El aviso de backup se muestra 3 segundos y se oculta solo
  useEffect(() => {
    if (!autoBackupDue) return
    const t = setTimeout(() => setAutoBackupDue(false), 3000)
    return () => clearTimeout(t)
  }, [autoBackupDue])

  async function handleAutoBackupDownload() {
    try {
      const json = await exportBackupJSON()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `planilla-backup-auto-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      markAutoBackupDone()
      setAutoBackupDue(false)
      setAutoBackupDone(true)
      setTimeout(() => setAutoBackupDone(false), 4000)
    } catch {
      // non-fatal
    }
  }

  async function handleRestoreFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      await importBackupJSON(text)
      setEmptyDb(false)
      setRecovered(true)
    } catch {
      alert('Error: archivo de backup inválido')
    }
    e.target.value = ''
  }

  // Show install gate if not running as installed PWA — after all hooks
  if (!isStandalone() && !gateSkipped) {
    return <InstallGate onSkip={() => setGateSkipped(true)} />
  }

  return (
    <div className="max-w-lg mx-auto min-h-screen relative">
      <div className="pb-16 vt-page-content">
        <Greeting />
        {/* Banners */}
        {recovered && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-blue-900/40 text-blue-300 text-sm flex items-start gap-2">
            <RefreshCw size={18} className="shrink-0 mt-0.5" />
            <span>Datos recuperados automáticamente desde el respaldo local.</span>
          </div>
        )}
        {persistDenied && !recovered && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-900/40 text-amber-300 text-sm flex items-start gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>El almacenamiento persistente no fue otorgado. Hacé backup periódicamente desde Configuración.</span>
          </div>
        )}
        {isIOSBrowser && !recovered && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-900/40 text-amber-300 text-sm flex items-start gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Safari puede borrar tus datos</p>
              <p className="text-xs text-amber-200/80">En iOS, Safari elimina los datos de la app si no la usás por 7 días o si hay poco espacio. Para evitarlo, <span className="font-semibold">instalá la app</span> desde Config → Instalar app, o hacé backups periódicos.</p>
            </div>
          </div>
        )}
        {autoBackupDue && (
          <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-xs text-amber-300/90">
            <AlertTriangle size={14} className="shrink-0 text-amber-400/80" />
            <span className="flex-1 leading-snug">Conviene descargar un backup.</span>
            <button
              onClick={handleAutoBackupDownload}
              className="shrink-0 flex items-center gap-1 font-semibold text-amber-300 active:text-amber-200"
            >
              <Download size={13} /> Backup
            </button>
            <button onClick={() => setAutoBackupDue(false)} className="shrink-0 text-amber-500/70 active:text-amber-300" aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>
        )}
        {autoBackupDone && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-900/40 text-emerald-300 text-sm flex items-center gap-2">
            <Download size={16} className="shrink-0" />
            <span>Backup automático descargado correctamente.</span>
          </div>
        )}
        {emptyDb && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm">
            <p className="font-semibold text-white mb-1">Sin datos guardados</p>
            <p className="text-xs text-slate-400 mb-3">Si tenías datos anteriores, podés restaurarlos desde un backup JSON.</p>
            <button
              onClick={() => restoreRef.current?.click()}
              className="w-full py-2 rounded-xl bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-2"
            >
              <FolderOpen size={14} /> Restaurar desde backup
            </button>
            <input ref={restoreRef} type="file" accept=".json" onChange={handleRestoreFromFile} className="hidden" />
          </div>
        )}

        {tab === "horas" && <HorasTrabajoPage />}
        {tab === "analytics" && <AnalyticsPage />}
        {tab === "settings" && <SettingsPage />}
        {tab === "salary" && SHOW_SALARY && <ProyeccionSalarialPage />}
      </div>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          <NavTab icon={<Clock size={22} />} label="Horas" active={tab === "horas"} onClick={() => goToTab("horas", tab, setTab)} />
          <NavTab icon={<BarChart3 size={22} />} label="Análisis" active={tab === "analytics"} onClick={() => goToTab("analytics", tab, setTab)} />
          <NavTab icon={<Settings2 size={22} />} label="Config" active={tab === "settings"} onClick={() => goToTab("settings", tab, setTab)} />
          {SHOW_SALARY && (
            <NavTab icon={<Banknote size={22} />} label="Sueldo" active={tab === "salary"} onClick={() => goToTab("salary", tab, setTab)} />
          )}
        </div>
      </nav>
    </div>
  )
}

function Greeting() {
  const { settings, loaded } = useSettings()
  const hora = new Date().getHours()
  const saludo = hora < 12 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches"
  const nombre = settings.nombreUsuario?.trim().split(/\s+/)[0] ?? ""

  if (!loaded) return null

  return (
    <div className="px-4 pt-3 pb-1">
      <p className="text-sm text-slate-400">
        {saludo}{nombre ? <span className="text-slate-200 font-semibold">, {nombre}</span> : ""}
      </p>
    </div>
  )
}

function NavTab({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={"relative flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors active:bg-slate-800/50 " + (active ? "text-blue-400" : "text-slate-500")}
    >
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-blue-400" />}
      <span className="leading-none">{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  )
}
