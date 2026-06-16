import { useState, useEffect, useRef } from "react"
import { Clock, Settings2, Banknote, BarChart3, RefreshCw, AlertTriangle, Download, FolderOpen, X, Database, Cloud, Users } from "lucide-react"
import { HorasTrabajoPage } from "./pages/HorasTrabajo"
import { SettingsPage } from "./pages/Settings"
import { AnalyticsPage } from "./pages/Analytics"
import { ProyeccionSalarialPage } from "./pages/ProyeccionSalarial"
import { AdminPage } from "./pages/Admin"
import { isSalaryUser, esAdminNube, esAdminCodigo2Ok } from "./lib/calculo-salarial"
import { lineaLabel } from "./lib/calculo-horas"
import { InstallGate } from "./components/InstallGate"
import { restoreFromShadow, db, exportBackupJSON, importBackupJSON, msSinceAutoBackup, markAutoBackupDone, msSinceCloudBackup, markCloudBackupDone, pruneOldRegistros, migrateHorasViaje, clearPeriodoPrueba, getSettings } from "./db/database"
import { refrescarParitarias } from "./lib/paritarias"
import { subirBackupNube, restaurarBackupNube, existeBackupNube, credencialesNubeValidas, quedanOperacionesNube, esAdminDispositivo, marcarAdminDispositivo, leerConfigNube, configCacheada, DIFUSION_VISTA_KEY, leerMensajeIndividual, marcarMensajeRecibido, ultimoUsuarioNube, setUltimoUsuarioNube, configurarNubeAuto, type AppConfig } from "./lib/cloud-backup"
import { useSettings } from "./hooks/useSettings"
import "./index.css"
import { OnboardingProvider, useOnboarding, onboardingHecho } from "./onboarding/OnboardingContext"
import { GuideTooltip } from "./components/GuideTooltip"
import { UpdateToast } from "./components/UpdateToast"
import { RecordatorioToast } from "./components/RecordatorioToast"
import { actualizarAgenda, enVentana, recordatorioDescartado, descartarRecordatorio, notificacionesConcedidas, registrarSyncPeriodico, recordatorioHabilitado } from "./lib/recordatorio"
import { BroadcastToast } from "./components/BroadcastToast"
import { Caracol } from "./components/Caracol"

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
}

const AUTO_BACKUP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000 // 2 days
const CLOUD_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 1 día (respaldo automático a la nube; se saltea si nada cambió)

// Aviso "sin datos guardados": reaparece como mucho 1 vez por semana y se oculta solo
const EMPTY_DB_ALERT_KEY = "planilla-empty-db-alert-ts"
const EMPTY_DB_ALERT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 1 semana
const EMPTY_DB_AUTOHIDE_MS = 8000

// Id del último mensaje INDIVIDUAL visto por este dispositivo (no vuelve a aparecer una vez cerrado).
const MSG_IND_VISTO_KEY = "planilla-msg-ind-visto"

// Easter egg: la pestaña "Sueldo" se desbloquea con 15 toques al caracol (si el nombre es la
// palabra clave) y queda persistida acá — así no se re-chequea el nombre en cada cambio de pestaña.
const SALARY_UNLOCK_KEY = "planilla-salary-unlocked"
// La pantalla de ADMIN (padrón) se desbloquea con 3 toques al caracol + nombre "Nicolas Vazquez" +
// código "000000". Su flag persistido vive en cloud-backup (esAdminDispositivo/marcarAdminDispositivo),
// que además exime a ese dispositivo del tope diario de nube.

type Tab = "horas" | "analytics" | "settings" | "salary" | "admin"
const TAB_ORDER: Tab[] = ["horas", "analytics", "settings", "salary", "admin"]

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
  // La proyección salarial queda OCULTA por defecto. Se revela sólo con el easter egg del caracol
  // (15 toques) si el nombre es la palabra clave, y queda desbloqueada (persistida). Ya NO se
  // re-chequea en cada cambio de pestaña: ese getSettings() async hacía parpadear el nav inferior.
  const [showSalary, setShowSalary] = useState(() => {
    try { return localStorage.getItem(SALARY_UNLOCK_KEY) === "1" } catch { return false }
  })
  // Pantalla de admin (padrón) desbloqueada: persistida, independiente del salario.
  const [showAdmin, setShowAdmin] = useState(esAdminDispositivo)
  const [recovered, setRecovered] = useState(false)
  const [persistDenied, setPersistDenied] = useState(false)
  const [autoBackupDue, setAutoBackupDue] = useState(false)
  const [autoBackupDone, setAutoBackupDone] = useState(false)
  const [cloudBackupDone, setCloudBackupDone] = useState(false)
  const [cloudRestoreOffer, setCloudRestoreOffer] = useState(false)
  const [recordatorio, setRecordatorio] = useState<{ cierreMs: number } | null>(null)
  const [iosBannerVisible, setIosBannerVisible] = useState(true) // aviso "instalá la app" (iOS): se auto-oculta a los 5s
  const [emptyDb, setEmptyDb] = useState(false)
  const [gateSkipped, setGateSkipped] = useState(false)
  const [updateToast, setUpdateToast] = useState(false)
  // Config global (donador on/off + mensaje de difusión). Arranca con la caché (sincrónica) y se
  // refresca de la nube al abrir. El mensaje de difusión, si es nuevo, se muestra una sola vez.
  const [config, setConfig] = useState<AppConfig>(configCacheada)
  const [broadcast, setBroadcast] = useState<{ id: string; titulo: string; cuerpo: string } | null>(null)
  // Mensaje INDIVIDUAL del admin para este usuario (le aparece como una difusión dirigida).
  const [mensajeInd, setMensajeInd] = useState<{ id: string; titulo: string; cuerpo: string } | null>(null)
  // Donador activado para ESTE usuario por el admin (aunque esté apagado para todos).
  const [beggarUser, setBeggarUser] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)
  // Alto real del nav (incluye safe-area) para apoyar el caracol del easter egg en su borde.
  const navRef = useRef<HTMLElement>(null)
  const [navH, setNavH] = useState(56)

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
      window.setTimeout(() => window.location.reload(), 5000)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])
  useEffect(() => {
    if (!onboardingHecho()) onb.start()
  }, [])

  // Config global desde la nube: actualiza el flag del donador y, si hay un mensaje de difusión que
  // este usuario no vio, lo muestra (una sola vez). Lectura automática (no cuenta contra el tope diario).
  useEffect(() => {
    void (async () => {
      let cfg: AppConfig
      try { cfg = await leerConfigNube() } catch { return /* offline: queda la config cacheada */ }
      setConfig(cfg)
      // Si hay un mensaje de difusión que este usuario no vio, mostrarlo (una sola vez para todos).
      try {
        if (cfg.difusionId && localStorage.getItem(DIFUSION_VISTA_KEY) !== cfg.difusionId) {
          setBroadcast({ id: cfg.difusionId, titulo: cfg.difusionTitulo, cuerpo: cfg.difusionCuerpo })
        }
      } catch { /* ignore */ }
    })()
  }, [])

  // Cierra el cartel de difusión y lo marca como visto (no vuelve a salir para este usuario).
  function cerrarBroadcast() {
    if (broadcast) { try { localStorage.setItem(DIFUSION_VISTA_KEY, broadcast.id) } catch { /* ignore */ } }
    setBroadcast(null)
  }

  // Mensaje INDIVIDUAL del admin: lee mensajes/{docId-propio} al abrir; si hay uno nuevo lo muestra
  // como difusión dirigida (lectura automática, no cuenta contra el tope diario).
  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        if (!credencialesNubeValidas(s.nombreUsuario, s.backupCodigo)) return
        const msg = await leerMensajeIndividual(s.nombreUsuario, s.backupCodigo)
        if (!msg) return
        if (msg.beggar) setBeggarUser(true) // donador activado para este usuario por el admin
        if (msg.titulo || msg.cuerpo) {
          let visto = ''
          try { visto = localStorage.getItem(MSG_IND_VISTO_KEY) ?? '' } catch { /* ignore */ }
          if (msg.id !== visto) setMensajeInd({ id: msg.id, titulo: msg.titulo, cuerpo: msg.cuerpo })
        }
      } catch { /* offline / sin credenciales */ }
    })()
  }, [])

  // Cierra el mensaje individual: lo marca como visto y envía el ACUSE de recepción al admin.
  function cerrarMensajeInd() {
    if (mensajeInd) {
      try { localStorage.setItem(MSG_IND_VISTO_KEY, mensajeInd.id) } catch { /* ignore */ }
      void (async () => {
        try { const s = await getSettings(); await marcarMensajeRecibido(s.nombreUsuario, s.backupCodigo) } catch { /* best-effort */ }
      })()
    }
    setMensajeInd(null)
  }

  // Medir el alto del nav (cambia con el safe-area y si aparece la pestaña Sueldo) para el caracol.
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const medir = () => setNavH(el.offsetHeight)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showSalary, showAdmin])

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

      // Recordatorio de fin de período: refresca la agenda (próximo cierre) que lee el SW y decide el
      // aviso en-app. Si ya están activas las notificaciones, re-asegura el sync periódico (Android).
      try {
        const agenda = await actualizarAgenda()
        if (recordatorioHabilitado()) {
          if (notificacionesConcedidas()) await registrarSyncPeriodico()
          if (enVentana(agenda) && !recordatorioDescartado(agenda.cierreMs)) {
            setRecordatorio({ cierreMs: agenda.cierreMs })
          }
        }
      } catch { /* non-fatal */ }

      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist()
        if (!granted) setPersistDenied(true)
      }

      // Check record count after shadow restore
      try {
        const count = await db.registros.count()
        const s = await getSettings()
        const cloudOn = credencialesNubeValidas(s.nombreUsuario, s.backupCodigo)
        // Baseline del nombre con el que existe el respaldo (para detectar una corrección de nombre luego).
        if (cloudOn && !ultimoUsuarioNube()) setUltimoUsuarioNube(s.nombreUsuario)
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
            // Respaldo automático y silencioso a la nube (cada >=3 días al abrir la app).
            // soloSiCambio: si nada cambió desde la última subida, no sube (ahorra datos móviles).
            try {
              const subido = await subirBackupNube(s.nombreUsuario, s.backupCodigo, lineaLabel(s.lineaTrabajo), { soloSiCambio: true })
              markCloudBackupDone()
              if (subido) setCloudBackupDone(true)
            } catch { /* sin conexión: reintenta en el próximo arranque */ }
          } else if (!cloudOn && s.nombreUsuario.trim() && onboardingHecho() && quedanOperacionesNube()) {
            // Usuario con nombre y datos pero SIN respaldo en la nube: le generamos el código y subimos
            // su primer respaldo automáticamente (una sola vez; después cae en la rama cloudOn de arriba).
            // No corre si va a arrancar el tour completo (1ª vez), que ya configura la nube en su paso.
            try {
              const { subido } = await configurarNubeAuto(s.nombreUsuario, lineaLabel(s.lineaTrabajo))
              if (subido) { markCloudBackupDone(); setCloudBackupDone(true) }
            } catch { /* sin conexión: el código quedó guardado y reintenta al próximo arranque */ }
          } else if (!cloudOn && msSinceAutoBackup() > AUTO_BACKUP_INTERVAL_MS) {
            // Sin nombre (no se puede configurar la nube): recordatorio de backup manual a archivo.
            setAutoBackupDue(true)
          }
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

  // El aviso "instalá la app" (navegador, iOS) se oculta solo a los 5s para no quedar fijo arriba.
  useEffect(() => {
    if (!isIOSBrowser) return
    const t = setTimeout(() => setIosBannerVisible(false), 5000)
    return () => clearTimeout(t)
  }, [isIOSBrowser])

  // Bloquear scroll en la pantalla de Horas (no se necesita) y volver arriba al cambiar de pestaña
  useEffect(() => {
    window.scrollTo(0, 0)
    document.body.style.overflow = tab === 'horas' ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [tab])

  // Easter egg del caracol: 15 toques seguidos (sin feedback) revelan la pestaña Sueldo, pero SÓLO
  // si el nombre es la palabra clave (isSalaryUser). Queda desbloqueada (persistida) para no repetir
  // el gesto ni re-chequear el nombre en cada cambio de pestaña (lo que hacía parpadear el nav).
  async function desbloquearSalarioSecreto() {
    try {
      const s = await getSettings()
      if (isSalaryUser(s.nombreUsuario)) {
        try { localStorage.setItem(SALARY_UNLOCK_KEY, "1") } catch { /* ignore */ }
        setShowSalary(true)
      }
    } catch { /* ignore */ }
  }

  // Easter egg del caracol (3 toques): desbloquea SÓLO la pantalla de admin si el nombre es
  // "Nicolas Vazquez", el código de respaldo es "000000" Y el SEGUNDO código (campo extra "Código")
  // es el correcto. No toca el salario. Queda persistido.
  async function desbloquearAdminSecreto() {
    try {
      const s = await getSettings()
      if (esAdminNube(s.nombreUsuario, s.backupCodigo) && await esAdminCodigo2Ok()) {
        marcarAdminDispositivo()
        setShowAdmin(true)
      }
    } catch { /* ignore */ }
  }

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
        {isIOSBrowser && iosBannerVisible && !recovered && (
          <div className="mx-4 mt-3 rounded-xl bg-amber-900/40 overflow-hidden">
            <div className="p-3 text-amber-300 text-sm flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Safari puede borrar tus datos</p>
                <p className="text-xs text-amber-200/80">En iOS, Safari elimina los datos de la app si no la usás por 7 días o si hay poco espacio. Para evitarlo, <span className="font-semibold">instalá la app</span> desde Config → Instalar app, o hacé backups periódicos.</p>
              </div>
            </div>
            {/* Barra de tiempo: se oculta solo a los 5s */}
            <div className="h-0.5 bg-amber-500/15">
              <div className="h-full bg-amber-400/70 animate-[countdown-bar_5s_linear_forwards]" />
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

        {tab === "horas" && <HorasTrabajoPage beggarActivo={config.beggarActivo || beggarUser} />}
        {tab === "analytics" && <AnalyticsPage />}
        {tab === "settings" && <SettingsPage />}
        {tab === "salary" && showSalary && <ProyeccionSalarialPage />}
        {tab === "admin" && showAdmin && <AdminPage />}
      </div>

      <nav ref={navRef} className="vt-bottom-nav fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          <NavTab icon={<Clock size={22} />} label="Horas" active={tab === "horas"} onClick={() => goToTab("horas", tab, setTab)} />
          <NavTab icon={<BarChart3 size={22} />} label="Análisis" active={tab === "analytics"} onClick={() => goToTab("analytics", tab, setTab)} />
          <NavTab icon={<Settings2 size={22} />} label="Config" active={tab === "settings"} onClick={() => goToTab("settings", tab, setTab)} />
          {showSalary && (
            <NavTab icon={<Banknote size={22} />} label="Sueldo" active={tab === "salary"} onClick={() => goToTab("salary", tab, setTab)} />
          )}
          {showAdmin && (
            <NavTab icon={<Users size={22} />} label="Admin" active={tab === "admin"} onClick={() => goToTab("admin", tab, setTab)} />
          )}
        </div>
      </nav>

      {/* Easter egg: el caracol sólo en Configuración, asomando al scrollear hasta el fondo. */}
      {tab === "settings" && <Caracol navH={navH} onSecret={desbloquearSalarioSecreto} onAdminSecret={desbloquearAdminSecreto} />}

      <GuideTooltip />
      {recordatorio && !onb.activo && (
        <RecordatorioToast
          cierreMs={recordatorio.cierreMs}
          onClose={() => { descartarRecordatorio(recordatorio.cierreMs); setRecordatorio(null) }}
        />
      )}
      {updateToast && <UpdateToast />}
      {broadcast && <BroadcastToast titulo={broadcast.titulo} cuerpo={broadcast.cuerpo} onClose={cerrarBroadcast} />}
      {!broadcast && mensajeInd && <BroadcastToast titulo={mensajeInd.titulo} cuerpo={mensajeInd.cuerpo} onClose={cerrarMensajeInd} />}
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
