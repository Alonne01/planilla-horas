import { useState, useEffect, useRef } from "react"
import { Clock, Settings2, Banknote, BarChart3, RefreshCw, AlertTriangle, Download, FolderOpen, X, Database, Cloud } from "lucide-react"
import { HorasTrabajoPage } from "./pages/HorasTrabajo"
import { SettingsPage } from "./pages/Settings"
import { AnalyticsPage } from "./pages/Analytics"
import { ProyeccionSalarialPage } from "./pages/ProyeccionSalarial"
import { isSalaryUser } from "./lib/calculo-salarial"
import { InstallGate } from "./components/InstallGate"
import { restoreFromShadow, db, exportBackupJSON, importBackupJSON, msSinceAutoBackup, markAutoBackupDone, msSinceCloudBackup, markCloudBackupDone, pruneOldRegistros, migrateHorasViaje, clearPeriodoPrueba, getSettings } from "./db/database"
import { refrescarParitarias } from "./lib/paritarias"
import { subirBackupNube, restaurarBackupNube, existeBackupNube, credencialesNubeValidas, quedanOperacionesNube } from "./lib/cloud-backup"
import { useSettings } from "./hooks/useSettings"
import "./index.css"
import { OnboardingProvider, useOnboarding, onboardingHecho } from "./onboarding/OnboardingContext"
import { GuideTooltip } from "./components/GuideTooltip"
import { CloudSetupModal } from "./components/CloudSetupModal"
import { UpdateToast } from "./components/UpdateToast"

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
}

const AUTO_BACKUP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000 // 2 days
const CLOUD_BACKUP_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000 // 3 días (respaldo automático a la nube)

// Aviso "configurá el respaldo en la nube" (usuarios con nombre sin nube). "Más tarde" lo pospone 7 días.
const CLOUD_PROMPT_SNOOZE_KEY = "planilla-cloud-prompt-snooze-ts"
const CLOUD_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
function cloudPromptSnoozed(): boolean {
  try {
    const ts = localStorage.getItem(CLOUD_PROMPT_SNOOZE_KEY)
    return !!ts && Date.now() - parseInt(ts, 10) < CLOUD_PROMPT_SNOOZE_MS
  } catch { return false }
}
function snoozeCloudPrompt(): void {
  try { localStorage.setItem(CLOUD_PROMPT_SNOOZE_KEY, String(Date.now())) } catch { /* ignore */ }
}

// Aviso "sin datos guardados": reaparece como mucho 1 vez por semana y se oculta solo
const EMPTY_DB_ALERT_KEY = "planilla-empty-db-alert-ts"
const EMPTY_DB_ALERT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 1 semana
const EMPTY_DB_AUTOHIDE_MS = 8000

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
  return (
    <OnboardingProvider>
      <AppContent />
    </OnboardingProvider>
  )
}

function AppContent() {
  const [tab, setTab] = useState<Tab>("horas")
  // La proyección salarial queda oculta salvo para el usuario de prueba (período de prueba).
  // Se re-lee al cambiar de pestaña para reflejar el nombre apenas se guarda en Configuración.
  const [showSalary, setShowSalary] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [persistDenied, setPersistDenied] = useState(false)
  const [autoBackupDue, setAutoBackupDue] = useState(false)
  const [autoBackupDone, setAutoBackupDone] = useState(false)
  const [cloudBackupDone, setCloudBackupDone] = useState(false)
  const [cloudRestoreOffer, setCloudRestoreOffer] = useState(false)
  const [cloudPromptOpen, setCloudPromptOpen] = useState(false)
  const [emptyDb, setEmptyDb] = useState(false)
  const [gateSkipped, setGateSkipped] = useState(false)
  const [updateToast, setUpdateToast] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)

  // ─── Walkthrough / onboarding: auto-arranca en el 1er inicio para CUALQUIER usuario (hasta completarlo/omitirlo) ───
  const onb = useOnboarding()
  useEffect(() => { onb.registrar({ setTab }) }, [])

  // Auto-actualización: cuando el SW nuevo toma el control (autoUpdate lo activa solo), mostramos el
  // toast y recargamos. `controllerchange` dispara en updates reales (y 1 vez en la 1ª instalación).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let done = false
    const onChange = () => {
      if (done) return
      done = true
      console.info('[Planilla] SW nuevo activo → toast + recarga')
      setUpdateToast(true)
      window.setTimeout(() => window.location.reload(), 3000)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])
  useEffect(() => {
    if (!onboardingHecho()) onb.start()
  }, [])

  // iOS Safari can silently erase PWA storage after 7 days of inactivity
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOSBrowser = (/iphone|ipad|ipod/i.test(ua) ||
    (ua.includes('Mac') && 'ontouchend' in document)) &&
    !window.matchMedia('(display-mode: standalone)').matches

  useEffect(() => {
    async function init() {
      // Bajar el calendario de paritarias remoto (si existe) para próximas proyecciones
      refrescarParitarias()

      const didRecover = await restoreFromShadow()
      if (didRecover) setRecovered(true)

      // Silently prune records older than 6 months
      try { await pruneOldRegistros() } catch { /* non-fatal */ }

      // Migrate old horasViaje=1 (boolean) to horasViaje=2 (hours)
      try { await migrateHorasViaje() } catch { /* non-fatal */ }

      // Limpiar restos de la "planilla de prueba" del tutorial (si se salió sin completar).
      try { await clearPeriodoPrueba() } catch { /* non-fatal */ }

      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist()
        if (!granted) setPersistDenied(true)
      }

      // Check record count after shadow restore
      try {
        const count = await db.registros.count()
        const s = await getSettings()
        const cloudOn = credencialesNubeValidas(s.nombreUsuario, s.backupCodigo)
        if (count === 0 && !didRecover) {
          // Si hay credenciales y EXISTE un respaldo en la nube, ofrecer restaurarlo;
          // si no, el aviso de "sin datos" (a lo sumo 1 vez por semana).
          let hayNube = false
          if (cloudOn && quedanOperacionesNube()) {
            try { hayNube = await existeBackupNube(s.nombreUsuario, s.backupCodigo) } catch { /* sin conexión */ }
          }
          if (hayNube) {
            setCloudRestoreOffer(true)
          } else {
            const last = localStorage.getItem(EMPTY_DB_ALERT_KEY)
            const since = last ? Date.now() - parseInt(last, 10) : Infinity
            if (since > EMPTY_DB_ALERT_INTERVAL_MS) {
              localStorage.setItem(EMPTY_DB_ALERT_KEY, String(Date.now()))
              setEmptyDb(true)
            }
          }
        } else if (count > 0) {
          if (cloudOn && msSinceCloudBackup() > CLOUD_BACKUP_INTERVAL_MS && quedanOperacionesNube()) {
            // Respaldo automático y silencioso a la nube (cada >=3 días al abrir la app)
            try {
              await subirBackupNube(s.nombreUsuario, s.backupCodigo)
              markCloudBackupDone()
              setCloudBackupDone(true)
            } catch { /* sin conexión: reintenta en el próximo arranque */ }
          } else if (!cloudOn && msSinceAutoBackup() > AUTO_BACKUP_INTERVAL_MS) {
            setAutoBackupDue(true)
          }
        }
        // Usuarios con nombre pero sin respaldo en la nube (post-deploy): ofrecer configurarlo,
        // salvo que vaya a arrancar el tour completo (1ª vez, cualquier usuario) o esté pospuesto.
        const fullTourVaArrancar = !onboardingHecho()
        if (s.nombreUsuario.trim() && !cloudOn && !fullTourVaArrancar && !cloudPromptSnoozed()) {
          setCloudPromptOpen(true)
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

  // El toast "respaldado en la nube" se oculta solo a los 4s
  useEffect(() => {
    if (!cloudBackupDone) return
    const t = setTimeout(() => setCloudBackupDone(false), 4000)
    return () => clearTimeout(t)
  }, [cloudBackupDone])

  // El aviso "sin datos guardados" también se oculta solo
  useEffect(() => {
    if (!emptyDb) return
    const t = setTimeout(() => setEmptyDb(false), EMPTY_DB_AUTOHIDE_MS)
    return () => clearTimeout(t)
  }, [emptyDb])

  // El aviso de almacenamiento no persistente se oculta solo a los 5s
  useEffect(() => {
    if (!persistDenied) return
    const t = setTimeout(() => setPersistDenied(false), 5000)
    return () => clearTimeout(t)
  }, [persistDenied])

  // Bloquear scroll en la pantalla de Horas (no se necesita) y volver arriba al cambiar de pestaña
  useEffect(() => {
    window.scrollTo(0, 0)
    document.body.style.overflow = tab === 'horas' ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [tab])

  // Re-evaluar el gate salarial al cambiar de pestaña (refleja el nombre recién guardado)
  useEffect(() => {
    getSettings().then(s => setShowSalary(isSalaryUser(s.nombreUsuario))).catch(() => {})
  }, [tab])

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

  // Restaura desde la nube usando las credenciales ya guardadas (oferta en DB vacía).
  async function handleCloudRestore() {
    try {
      const s = await getSettings()
      const r = await restaurarBackupNube(s.nombreUsuario, s.backupCodigo)
      setCloudRestoreOffer(false)
      if (r === 'ok') setRecovered(true)
    } catch {
      // sin conexión: dejar la oferta para reintentar
    }
  }

  // Modal "configurá el respaldo": llevar a Config + correr el mini-tour de nube.
  function handleCloudConfigurar() {
    setCloudPromptOpen(false)
    setTab("settings")
    onb.start("cloud")
  }
  function handleCloudMasTarde() {
    snoozeCloudPrompt()
    setCloudPromptOpen(false)
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
          <div className="mx-4 mt-3 rounded-xl bg-amber-900/40 overflow-hidden">
            <div className="p-3 text-amber-300 text-sm flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <span>El almacenamiento persistente no fue otorgado. Hacé backup periódicamente desde Configuración.</span>
            </div>
            {/* Barra de tiempo: se oculta solo a los 5s */}
            <div className="h-0.5 bg-amber-500/15">
              <div className="h-full bg-amber-400/70 animate-[countdown-bar_5s_linear_forwards]" />
            </div>
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
          <div className="mx-4 mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-300/90">
              <AlertTriangle size={14} className="shrink-0 text-amber-400/80" />
              <span className="flex-1 leading-snug">Sin respaldo. Activá la nube en Config, o descargá un backup.</span>
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
            {/* Barra de tiempo: indica cuánto falta para que se oculte */}
            <div className="h-0.5 bg-amber-500/15">
              <div className="h-full bg-amber-400/70 animate-[countdown-bar_3s_linear_forwards]" />
            </div>
          </div>
        )}
        {autoBackupDone && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-900/40 text-emerald-300 text-sm flex items-center gap-2">
            <Download size={16} className="shrink-0" />
            <span>Backup automático descargado correctamente.</span>
          </div>
        )}
        {cloudBackupDone && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-900/40 text-emerald-300 text-sm flex items-center gap-2">
            <Cloud size={16} className="shrink-0" />
            <span>Respaldado en la nube.</span>
          </div>
        )}
        {cloudRestoreOffer && (
          <div className="mx-4 mt-2 rounded-lg bg-blue-500/10 border border-blue-500/20 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-blue-200">
              <Cloud size={14} className="shrink-0 text-blue-300" />
              <span className="flex-1 leading-snug">Hay un respaldo en la nube para tu usuario.</span>
              <button onClick={handleCloudRestore} className="shrink-0 flex items-center gap-1 font-semibold text-blue-300 active:text-blue-200">
                <Download size={13} /> Restaurar
              </button>
              <button onClick={() => setCloudRestoreOffer(false)} className="shrink-0 text-blue-400/70 active:text-blue-200" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        {emptyDb && (
          <div className="mx-4 mt-2 rounded-lg bg-slate-700/20 border border-slate-600/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300">
              <Database size={14} className="shrink-0 text-slate-400" />
              <span className="flex-1 leading-snug">Sin datos guardados.</span>
              <button
                onClick={() => restoreRef.current?.click()}
                className="shrink-0 flex items-center gap-1 font-semibold text-blue-300 active:text-blue-200"
              >
                <FolderOpen size={13} /> Restaurar
              </button>
              <button onClick={() => setEmptyDb(false)} className="shrink-0 text-slate-500 active:text-slate-300" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            {/* Barra de tiempo: indica cuánto falta para que se oculte */}
            <div className="h-0.5 bg-slate-600/20">
              <div className="h-full bg-slate-400/60 animate-[countdown-bar_8s_linear_forwards]" />
            </div>
          </div>
        )}
        {/* Input de restauración: fuera del banner para que sobreviva al auto-cierre durante la selección de archivo */}
        <input ref={restoreRef} type="file" accept=".json" onChange={handleRestoreFromFile} className="hidden" />

        {tab === "horas" && <HorasTrabajoPage />}
        {tab === "analytics" && <AnalyticsPage />}
        {tab === "settings" && <SettingsPage />}
        {tab === "salary" && showSalary && <ProyeccionSalarialPage />}
      </div>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          <NavTab icon={<Clock size={22} />} label="Horas" active={tab === "horas"} onClick={() => goToTab("horas", tab, setTab)} />
          <NavTab icon={<BarChart3 size={22} />} label="Análisis" active={tab === "analytics"} onClick={() => goToTab("analytics", tab, setTab)} />
          <NavTab icon={<Settings2 size={22} />} label="Config" active={tab === "settings"} onClick={() => goToTab("settings", tab, setTab)} />
          {showSalary && (
            <NavTab icon={<Banknote size={22} />} label="Sueldo" active={tab === "salary"} onClick={() => goToTab("salary", tab, setTab)} />
          )}
        </div>
      </nav>

      <GuideTooltip />
      {cloudPromptOpen && <CloudSetupModal onConfigurar={handleCloudConfigurar} onMasTarde={handleCloudMasTarde} />}
      {updateToast && <UpdateToast />}
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
