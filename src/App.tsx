import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react"
import { Clock, Settings2, TrendingUp, BarChart3, RefreshCw, AlertTriangle, Download, FolderOpen, X, Database, Cloud, Users, Monitor, LogOut } from "lucide-react"
import { HorasTrabajoPage } from "./pages/HorasTrabajo"
import { SettingsPage } from "./pages/Settings"
import { AnalyticsPage } from "./pages/Analytics"
import { AdminPage } from "./pages/Admin"
import { isSalaryUser, esAdminNube, salarioDesbloqueadoNube, marcarSalarioDesbloqueadoNube } from "./lib/calculo-salarial"
import { lineaLabel } from "./lib/calculo-horas"
import { InstallGate } from "./components/InstallGate"
import { restoreFromShadow, db, exportBackupJSON, importBackupJSON, msSinceAutoBackup, markAutoBackupDone, msSinceCloudBackup, markCloudBackupDone, pruneOldRegistros, migrateHorasViaje, clearPeriodoPrueba, getSettings, clearAllRegistros } from "./db/database"
import { refrescarParitarias } from "./lib/paritarias"
import { subirBackupNube, restaurarBackupNube, existeBackupNube, credencialesNubeValidas, quedanOperacionesNube, esAdminDispositivo, leerConfigNube, configCacheada, DIFUSION_VISTA_KEY, leerMensajeIndividual, marcarMensajeRecibido, ultimoUsuarioNube, setUltimoUsuarioNube, configurarNubeAuto, loginAdmin, asegurarAuthAdmin, deviceIdLocal, reclamarSalaryDevice, revocarSalaryConflicto, miDocIdNube, restaurarSharedDoc, subirSharedDoc, leerUpdatedAtDoc, autoBajarCambiosPC, type AppConfig } from "./lib/cloud-backup"
import { isMobilePhone } from "./lib/device"
import { cargarSesion, esValida, guardarSesion, limpiarSesion, renovar, type PCSession } from "./lib/pc-session"
import { PairGate } from "./components/PairGate"
import { useSettings } from "./hooks/useSettings"
import "./index.css"
import { setupHecho, marcarSetupHecho, tutorialVisto, marcarTutorialVisto, diagramaConfirmado, marcarDiagramaConfirmado, sectorConfirmado, marcarSectorConfirmado } from "./onboarding/tutorial"
import { WelcomeSetup } from "./components/WelcomeSetup"
import { SectorSetup } from "./components/SectorSetup"
import { DiagramaSetup } from "./components/DiagramaSetup"
import { TutorialSlides } from "./components/TutorialSlides"
import { UpdateToast } from "./components/UpdateToast"
import { RecordatorioToast } from "./components/RecordatorioToast"
import { actualizarAgenda, enVentana, recordatorioDescartado, descartarRecordatorio, notificacionesConcedidas, registrarSyncPeriodico, recordatorioHabilitado } from "./lib/recordatorio"
import { BroadcastToast } from "./components/BroadcastToast"
import { Caracol } from "./components/Caracol"

// Lazy: la proyección salarial (y su dependencia pesada recharts) sólo se descarga al abrir la
// pestaña Sueldo, así no infla el bundle inicial del resto de los usuarios.
const ProyeccionSalarialPage = lazy(() => import("./pages/ProyeccionSalarial").then(m => ({ default: m.ProyeccionSalarialPage })))

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
// Timestamp (updatedAt de la nube) de la última sincronización manual de la PC vinculada. Se usa para
// decidir la dirección del sync última-escritura-gana (bajar si la nube es más nueva; subir si no).
const PC_LAST_SYNC_KEY = "planilla-pc-last-sync"
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
  return <AppContent />
}

function AppContent() {
  const [tab, setTab] = useState<Tab>("horas")
  // ¿Este dispositivo es un teléfono? Se cachea una vez (la heurística toca APIs del navegador). El
  // sueldo queda HARD-OFF si NO es teléfono: en PC ni se descifra ni se muestra su UI.
  const esTelefono = useMemo(() => isMobilePhone(), [])
  // Sesión de la PC vinculada (dispositivo compañero efímero, estilo WhatsApp Web). Sólo aplica en
  // PC (no-teléfono). Sobrevive recargas; 1 día sliding; se limpia sola al expirar o con logout.
  const [pcSesion, setPcSesion] = useState<PCSession | null>(() => {
    const s = cargarSesion()
    return esValida(s, Date.now()) ? s : (limpiarSesion(), null)
  })
  const [syncEstado, setSyncEstado] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle')
  const ultimaRenovacionRef = useRef(0) // throttle de la renovación de sesión de PC (1/min)
  // La proyección salarial queda OCULTA por defecto. Se revela sólo con el easter egg del caracol
  // (15 toques) si el nombre es la palabra clave, y queda desbloqueada (persistida). Ya NO se
  // re-chequea en cada cambio de pestaña: ese getSettings() async hacía parpadear el nav inferior.
  // En PC (no-teléfono) queda SIEMPRE en false: el sueldo no existe ni se muestra fuera del teléfono.
  const [showSalary, setShowSalary] = useState(() => {
    try { return esTelefono && (localStorage.getItem(SALARY_UNLOCK_KEY) === "1" || salarioDesbloqueadoNube()) } catch { return false }
  })
  // Pantalla de admin (padrón) desbloqueada: persistida, independiente del salario.
  const [showAdmin, setShowAdmin] = useState(esAdminDispositivo)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
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

  // ─── Primer inicio: setup OBLIGATORIO (nombre + apellido → código → respaldo) + tutorial simple ───
  // El setup bloquea la pantalla hasta cargar el nombre; el tutorial (carrusel) se muestra una vez
  // después y se puede reabrir desde el menú ⋮.
  const [showWelcome, setShowWelcome] = useState(false)
  const [showSector, setShowSector] = useState(false)
  const [showDiagrama, setShowDiagrama] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        // Auto-confirmar sector y diagrama para usuarios EXISTENTES (ya tienen datos): así no se les
        // muestran los prompts. Sólo quedan pendientes para usuarios genuinamente nuevos.
        const count = await db.registros.count()
        if (!diagramaConfirmado() && (count > 0 || s.diagramaInicioMs > 0)) marcarDiagramaConfirmado()
        if (!sectorConfirmado() && count > 0) marcarSectorConfirmado()
        // El onboarding (nombre/sector/diagrama) corre SÓLO en el teléfono, dueño de la cuenta. La PC es
        // un compañero efímero: su cuenta y su config llegan del teléfono al vincular, así que nunca debe
        // pedir "crear cuenta" ni elegir sector/diagrama.
        if (esTelefono) {
          // Setup obligatorio sólo a usuarios nuevos (sin nombre y sin haber pasado por el setup).
          if (!s.nombreUsuario.trim() && !setupHecho()) setShowWelcome(true)
          // Tiene nombre pero falta elegir sector / diagrama → prompts al abrir (sector primero).
          else if (!sectorConfirmado()) setShowSector(true)
          else if (!diagramaConfirmado()) setShowDiagrama(true)
        }
      } catch { /* ignore */ }
    })()
    // esTelefono es estable (useMemo []); se incluye para el linter sin cambiar el "corre una vez".
  }, [esTelefono])

  function welcomeDone() {
    marcarSetupHecho()
    setShowWelcome(false)
    // Tras el setup vienen el sector y el diagrama (obligatorios); el tutorial va después.
    if (!sectorConfirmado()) setShowSector(true)
    else if (!diagramaConfirmado()) setShowDiagrama(true)
    else if (!tutorialVisto()) setShowTutorial(true)
  }
  function sectorDone() {
    setShowSector(false)
    if (!diagramaConfirmado()) setShowDiagrama(true)
    else if (!tutorialVisto()) setShowTutorial(true)
  }
  function diagramaDone() {
    setShowDiagrama(false)
    if (!tutorialVisto()) setShowTutorial(true) // tras confirmar el diagrama, el tutorial una vez
  }
  function tutorialDone() {
    marcarTutorialVisto()
    setShowTutorial(false)
  }

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
        // Proyección salarial — device-binding (TOFU): el ALTA la da el admin (salaryUnlock); ESTE
        // dispositivo la reclama una vez. Un 2º dispositivo (otro deviceId) o un conflicto marcado la
        // revocan para todos; cambiar el código ⇒ docId nuevo sin permiso ⇒ revocado solo.
        const habilitarSalario = (on: boolean) => {
          marcarSalarioDesbloqueadoNube(on)
          if (on) setShowSalary(true)
          else if (localStorage.getItem(SALARY_UNLOCK_KEY) !== "1") setShowSalary(false)
        }
        if (msg.salaryUnlock && !msg.salaryConflict) {
          const myDev = deviceIdLocal()
          const docId = await miDocIdNube(s.nombreUsuario, s.backupCodigo)
          if (!msg.salaryDeviceId) { await reclamarSalaryDevice(docId, myDev); habilitarSalario(true) }      // 1er device
          else if (msg.salaryDeviceId === myDev) habilitarSalario(true)                                      // device autorizado
          else { await revocarSalaryConflicto(docId); habilitarSalario(false) }                              // 2º device → revoca a ambos
        } else {
          habilitarSalario(false)
        }
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
          // TELÉFONO: bajar automáticamente lo que la PC vinculada dejó en la nube, SÓLO si el teléfono
          // no tiene ediciones locales sin subir (así nunca se pisan cambios propios). Esto hace que
          // "cambié en la PC → abro el teléfono → aparecen los cambios" funcione sin tocar botones. El
          // sueldo local queda intacto (la PC nunca escribe la sección 'salary').
          if (esTelefono && cloudOn && quedanOperacionesNube()) {
            try {
              if (await autoBajarCambiosPC(s.nombreUsuario, s.backupCodigo)) {
                window.location.reload() // repuebla el calendario con lo bajado
                return
              }
            } catch { /* sin conexión: se reintenta al próximo arranque */ }
          }
          if (cloudOn && msSinceCloudBackup() > CLOUD_BACKUP_INTERVAL_MS && quedanOperacionesNube()) {
            // Respaldo automático y silencioso a la nube (cada >=3 días al abrir la app).
            // soloSiCambio: si nada cambió desde la última subida, no sube (ahorra datos móviles).
            try {
              const subido = await subirBackupNube(s.nombreUsuario, s.backupCodigo, lineaLabel(s.lineaTrabajo), { soloSiCambio: true })
              markCloudBackupDone()
              if (subido) setCloudBackupDone(true)
            } catch { /* sin conexión: reintenta en el próximo arranque */ }
          } else if (!cloudOn && s.nombreUsuario.trim() && setupHecho() && quedanOperacionesNube()) {
            // Usuario con nombre y datos pero SIN respaldo en la nube: le generamos el código y subimos
            // su primer respaldo automáticamente (una sola vez; después cae en la rama cloudOn de arriba).
            // No corre para usuarios nuevos: a ésos los configura el setup obligatorio del primer inicio.
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
    // esTelefono es estable (useMemo []); se incluye para el linter sin cambiar el "corre una vez".
  }, [esTelefono])

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

  // ─── PC vinculada: logout, sincronización y expiración de sesión (1 día sliding) ───
  // Logout de la PC: borra la sesión y TODOS los registros locales (la PC no deja rastro) y vuelve al
  // gate de vinculación. `clearAllRegistros` es best-effort (no bloquea el logout).
  const logoutPC = useCallback(() => {
    limpiarSesion()
    void clearAllRegistros()
    setPcSesion(null)
  }, [])

  // Al vincular: el PairGate ya restauró la sección shared y persistió la sesión. Recargamos para que
  // los hooks (lectura única al montar) repueblen el calendario con los datos bajados; sin esto queda
  // la DB vacía en memoria y salta "crear cuenta". Marcamos la sync para no re-bajar al primer botón.
  const onVinculadaPC = useCallback((s: PCSession) => {
    guardarSesion(s)
    try { localStorage.setItem(PC_LAST_SYNC_KEY, String(Date.now())) } catch { /* ignore */ }
    window.location.reload()
  }, [])

  // Sincronización manual última-escritura-gana: si la nube es más nueva que la última bajada, baja
  // (y recarga para repoblar el calendario); si no, sube la sección shared. Nunca toca el sueldo.
  async function sincronizarPC() {
    if (!pcSesion || syncEstado === 'busy') return
    setSyncEstado('busy')
    try {
      const raw = Uint8Array.from(atob(pcSesion.kSharedB64), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
      const cloudTs = await leerUpdatedAtDoc(pcSesion.docId)
      const localTs = Number(localStorage.getItem(PC_LAST_SYNC_KEY) ?? 0)
      if (cloudTs && cloudTs > localTs) {
        await restaurarSharedDoc(pcSesion.docId, raw)
        localStorage.setItem(PC_LAST_SYNC_KEY, String(cloudTs))
        setSyncEstado('ok')
        window.location.reload() // repuebla el calendario con los datos recién bajados
      } else {
        const ts = await subirSharedDoc(pcSesion.docId, raw)
        localStorage.setItem(PC_LAST_SYNC_KEY, String(ts))
        setSyncEstado('ok')
        window.setTimeout(() => setSyncEstado('idle'), 2500)
      }
    } catch {
      setSyncEstado('err')
      window.setTimeout(() => setSyncEstado('idle'), 3000)
    }
  }

  // Expiración deslizante: la actividad (toques/teclas) renueva la sesión (throttle 1/min) y un
  // chequeo cada minuto cierra la sesión si venció. Sólo activo mientras hay sesión de PC.
  useEffect(() => {
    if (!pcSesion) return
    const renovarActividad = () => {
      const ahora = Date.now()
      if (ahora - ultimaRenovacionRef.current < 60_000) return
      ultimaRenovacionRef.current = ahora
      const s = renovar(pcSesion, ahora)
      guardarSesion(s)
      setPcSesion(s)
    }
    window.addEventListener('pointerdown', renovarActividad)
    window.addEventListener('keydown', renovarActividad)
    const iv = window.setInterval(() => {
      if (!esValida(pcSesion, Date.now())) logoutPC()
    }, 60_000)
    return () => {
      window.removeEventListener('pointerdown', renovarActividad)
      window.removeEventListener('keydown', renovarActividad)
      window.clearInterval(iv)
    }
  }, [pcSesion, logoutPC])

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
      // Pre-gate de identidad: el login admin sólo aparece para Nicolas Vazquez + 000000. La autoridad
      // real la da el login Firebase Auth + las reglas (request.auth.uid).
      if (!esAdminNube(s.nombreUsuario, s.backupCodigo)) return
      if (esAdminDispositivo() && await asegurarAuthAdmin()) setShowAdmin(true) // sesión ya activa
      else setShowAdminLogin(true)                                              // pedir login
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

  // Install gate SÓLO en el teléfono (dueño de la cuenta): lo nudgea a instalar la PWA para no perder
  // datos. En la PC no aplica (es un compañero efímero y sus datos se borran al salir), así que va
  // directo al gate de vinculación. — después de todos los hooks.
  if (esTelefono && !isStandalone() && !gateSkipped) {
    return <InstallGate onSkip={() => setGateSkipped(true)} />
  }

  // Gate de vinculación de PC: en un dispositivo que NO es teléfono y sin sesión válida, se exige
  // vincular desde el teléfono (la PC no puede crear cuentas). El sueldo nunca vive/aparece en PC.
  if (!esTelefono && !pcSesion) {
    return <PairGate onVinculada={onVinculadaPC} />
  }

  return (
    <div className="max-w-lg mx-auto min-h-screen relative">
      <div className="pb-16 vt-page-content">
        <Greeting />
        {/* Barra de PC vinculada: sincronizar (última-escritura-gana) + cerrar sesión. Sólo en PC. */}
        {pcSesion && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 p-2.5">
            <Monitor size={16} className="shrink-0 text-teal-300" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-teal-200">PC vinculada</p>
              <p className="text-[11px] text-teal-300/70 truncate">
                {syncEstado === 'busy' ? 'Sincronizando…'
                  : syncEstado === 'ok' ? 'Sincronizado ✓'
                  : syncEstado === 'err' ? 'No se pudo sincronizar'
                  : 'Sesión temporal · el sueldo queda en el teléfono'}
              </p>
            </div>
            <button
              onClick={sincronizarPC}
              disabled={syncEstado === 'busy'}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white active:bg-teal-700 disabled:opacity-50"
            >
              <RefreshCw size={13} className={syncEstado === 'busy' ? 'animate-spin' : ''} /> Sincronizar
            </button>
            <button
              onClick={logoutPC}
              aria-label="Cerrar sesión de la PC"
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 active:bg-slate-600"
            >
              <LogOut size={13} /> Salir
            </button>
          </div>
        )}
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

        {tab === "horas" && <HorasTrabajoPage beggarActivo={config.beggarActivo || beggarUser} onAbrirTutorial={() => setShowTutorial(true)} />}
        {tab === "analytics" && <AnalyticsPage />}
        {tab === "settings" && <SettingsPage />}
        {esTelefono && tab === "salary" && showSalary && (
          <Suspense fallback={<div className="px-4 py-16 text-center text-slate-500 text-sm">Cargando…</div>}>
            <ProyeccionSalarialPage />
          </Suspense>
        )}
        {tab === "admin" && showAdmin && <AdminPage onLogout={() => { setShowAdmin(false); setTab("settings") }} />}
      </div>

      <nav ref={navRef} className="vt-bottom-nav fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="relative flex">
          {/* Indicador activo que SE DESLIZA entre pestañas (en vez de saltar). Se posiciona sobre la
              pestaña activa según su índice entre las pestañas visibles (Sueldo/Admin son opcionales). */}
          {(() => {
            const order: Tab[] = ["horas", "analytics", "settings"]
            if (esTelefono && showSalary) order.push("salary")
            if (showAdmin) order.push("admin")
            const idx = Math.max(0, order.indexOf(tab))
            return (
              <span
                className="pointer-events-none absolute top-0 flex justify-center transition-transform duration-300 ease-out"
                style={{ width: `${100 / order.length}%`, transform: `translateX(${idx * 100}%)` }}
              >
                <span className="h-0.5 w-8 rounded-full bg-blue-400" />
              </span>
            )
          })()}
          <NavTab icon={<Clock size={22} />} label="Horas" active={tab === "horas"} onClick={() => goToTab("horas", tab, setTab)} />
          <NavTab icon={<BarChart3 size={22} />} label="Análisis" active={tab === "analytics"} onClick={() => goToTab("analytics", tab, setTab)} />
          <NavTab icon={<Settings2 size={22} />} label="Config" active={tab === "settings"} onClick={() => goToTab("settings", tab, setTab)} />
          {esTelefono && showSalary && (
            <NavTab icon={<TrendingUp size={22} />} label="Proyección" active={tab === "salary"} onClick={() => goToTab("salary", tab, setTab)} />
          )}
          {showAdmin && (
            <NavTab icon={<Users size={22} />} label="Admin" active={tab === "admin"} onClick={() => goToTab("admin", tab, setTab)} />
          )}
        </div>
      </nav>

      {/* Easter egg: el caracol sólo en Configuración, asomando al scrollear hasta el fondo. */}
      {tab === "settings" && <Caracol navH={navH} onSecret={desbloquearSalarioSecreto} onAdminSecret={desbloquearAdminSecreto} />}

      {recordatorio && !showWelcome && !showSector && !showDiagrama && (
        <RecordatorioToast
          cierreMs={recordatorio.cierreMs}
          onClose={() => { descartarRecordatorio(recordatorio.cierreMs); setRecordatorio(null) }}
        />
      )}
      {updateToast && <UpdateToast />}
      {/* Si hay actualización en curso, la difusión/mensaje ESPERA: primero se actualiza y recarga,
          y al volver a abrir (sin updateToast) la difusión se muestra (no se marcó como vista). */}
      {!updateToast && broadcast && <BroadcastToast titulo={broadcast.titulo} cuerpo={broadcast.cuerpo} onClose={cerrarBroadcast} />}
      {!updateToast && !broadcast && mensajeInd && <BroadcastToast titulo={mensajeInd.titulo} cuerpo={mensajeInd.cuerpo} onClose={cerrarMensajeInd} />}

      {/* Primer inicio: setup obligatorio → sector → diagrama (vista previa) → tutorial simple (carrusel) */}
      {showTutorial && <TutorialSlides onClose={tutorialDone} />}
      {showDiagrama && !showWelcome && !showSector && <DiagramaSetup onDone={diagramaDone} />}
      {showSector && !showWelcome && <SectorSetup onDone={sectorDone} />}
      {showWelcome && <WelcomeSetup onDone={welcomeDone} />}

      {showAdminLogin && (
        <AdminLoginModal
          onClose={() => setShowAdminLogin(false)}
          onSuccess={() => { setShowAdminLogin(false); setShowAdmin(true) }}
        />
      )}
    </div>
  )
}

/** Login del admin (Firebase Auth email/password). Solo se llega acá tras el gesto del caracol con la
 *  identidad correcta (Nicolas Vazquez + 000000). El acceso real lo dan las reglas con el UID. */
function AdminLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState("")
  const [pass, setPass] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  async function entrar() {
    if (!email.trim() || !pass) return
    setBusy(true); setErr(false)
    const ok = await loginAdmin(email, pass)
    setBusy(false)
    if (ok) onSuccess()
    else setErr(true)
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-slate-800 p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-bold text-white">Acceso de administrador</p>
        <input
          type="email" inputMode="email" autoComplete="username" value={email}
          onChange={e => setEmail(e.target.value)} placeholder="Email"
          className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="password" autoComplete="current-password" value={pass}
          onChange={e => setPass(e.target.value)} placeholder="Contraseña"
          onKeyDown={e => { if (e.key === "Enter") void entrar() }}
          className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-[11px] text-red-300">Credenciales incorrectas o sin conexión.</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs font-medium text-slate-300 rounded-lg bg-slate-700 active:bg-slate-600 disabled:opacity-50">Cancelar</button>
          <button onClick={() => void entrar()} disabled={busy || !email.trim() || !pass} className="px-3 py-1.5 text-xs font-bold text-white rounded-lg bg-blue-600 active:bg-blue-700 disabled:opacity-50">{busy ? "Entrando…" : "Entrar"}</button>
        </div>
      </div>
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
      <span className={"leading-none transition-transform duration-200 " + (active ? "scale-110" : "scale-100")}>{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  )
}
