import { useState, useEffect } from 'react'
import { AlertTriangle, Download, FolderOpen, ChevronUp, ChevronDown, X, Smartphone, Trash2, CalendarDays, Banknote, Cloud, Lock, Unlock, Shuffle } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { DIAGRAMAS, type DiagramaPatternKey } from '../lib/diagrama'
import { exportBackupJSON, importBackupJSON, msSinceLastBackup, markBackupDone, clearAllRegistros, msSinceCloudBackup, markCloudBackupDone } from '../db/database'
import { actualizarFeriadosNacionales, feriadosActualizadoMs } from '../lib/feriados'
import { CONVENIOS, isSalaryUser, fmtBasicoDisplay, formatBasicoInput, parseBasicoInput, type Convenio, type TipoTurno } from '../lib/calculo-salarial'
import { LINEAS_TRABAJO, lineaLabel, type LineaTrabajo } from '../lib/calculo-horas'
import { subirBackupNube, restaurarBackupNube, credencialesNubeValidas, quedanOperacionesNube } from '../lib/cloud-backup'
import { useOnboarding } from '../onboarding/OnboardingContext'
import { APP_VERSION } from '../version'

declare const __BUILD_TIME__: string

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Candado de la configuración de trabajo (línea de trabajo / diagrama / fecha de inicio): evita
// toques accidentales que cambien el conteo de horas. Device-local (no se sincroniza); por defecto
// BLOQUEADO. Se ignora durante el tour guiado (que necesita tocar esos controles para configurar).
const CONFIG_LOCK_KEY = 'planilla-config-lock'
function leerConfigLock(): boolean {
  try { return localStorage.getItem(CONFIG_LOCK_KEY) !== '0' } catch { return true }
}
function guardarConfigLock(bloqueado: boolean): void {
  try { localStorage.setItem(CONFIG_LOCK_KEY, bloqueado ? '1' : '0') } catch { /* ignore */ }
}

// Kaomoji elegido una vez por inicio de app (constante a nivel de módulo)
const KAOMOJIS = [
  '(づ｡◕‿‿◕｡)づ', '(◕‿◕)', '(｡♥‿♥｡)', '٩(◕‿◕)۶', '(★^O^★)',
  'ヽ(´▽`)/', '(＾▽＾)', '(•‿•)', '(¬‿¬)', '(╯°□°）╯︵ ┻━┻',
  '┬─┬ ノ( ゜-゜ノ)', '(っ◔◡◔)っ', 'ヽ(•‿•)ノ', '(ﾉ◕ヮ◕)ﾉ', '( ͡° ͜ʖ ͡°)',
  '(＾◡＾)', '＼(^o^)／', '(ง •̀_•́)ง', '(¬_¬")', 'ʕ•ᴥ•ʔ',
]
const KAOMOJI = KAOMOJIS[Math.floor(Math.random() * KAOMOJIS.length)]

function localDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseDateLocal(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function SettingsPage() {
  const { settings, update, loaded } = useSettings()
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [backupOverdue, setBackupOverdue] = useState(false)
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0)
  const [feriadosBusy, setFeriadosBusy] = useState(false)
  const [feriadosUpd, setFeriadosUpd] = useState(() => feriadosActualizadoMs())

  // Estado local del formulario — auto-guardado (con debounce) tras cada cambio
  const [nombre, setNombre] = useState('')
  const [diagrama, setDiagrama] = useState<DiagramaPatternKey>('LUNES_VIERNES')
  const [diagramaFecha, setDiagramaFecha] = useState('')
  const [linea, setLinea] = useState<LineaTrabajo>('SURFACE_WELL_TESTING')
  const [dirty, setDirty] = useState(false)
  // Salario (visible sólo para el usuario de prueba)
  const [convenio, setConvenio] = useState<Convenio>('CCT_637_11')
  const [sueldoBasico, setSueldoBasico] = useState('')
  const [fechaIngreso, setFechaIngreso] = useState('')
  const [tipoTurno, setTipoTurno] = useState<TipoTurno>('NINGUNO')
  const [zonaVM, setZonaVM] = useState(false)
  const [tasaDesarraigo, setTasaDesarraigo] = useState(0.20)
  // Respaldo en la nube (identidad = nombre del empleado + código de 6 dígitos, con candado)
  const [bkCodigo, setBkCodigo] = useState('')
  const [bkBloqueado, setBkBloqueado] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [limiteMsg, setLimiteMsg] = useState<string | null>(null) // modal de tope diario de nube
  const [cloudMs, setCloudMs] = useState<number>(() => msSinceCloudBackup())

  useEffect(() => {
    if (!loaded) return
    // El aviso de "sin respaldo" sólo aplica si NO está configurado el respaldo en la nube.
    const cloudOn = credencialesNubeValidas(settings.nombreUsuario, settings.backupCodigo)
    setBackupOverdue(!cloudOn && msSinceLastBackup() > SEVEN_DAYS_MS)
  }, [loaded])

  // Acciones del tour: actualizar feriados + guardar (referencias frescas cada render).
  const onb = useOnboarding()
  useEffect(() => { onb.registrar({ actualizarFeriados: handleActualizarFeriados, guardarConfig: handleGuardar }) })

  // Candado de línea/diagrama/fecha. Bloqueado por defecto; durante el tour se ignora para poder
  // configurar. `cfgEditable` = se pueden tocar esos controles.
  const [cfgBloqueado, setCfgBloqueado] = useState(leerConfigLock)
  const cfgEditable = !cfgBloqueado || onb.activo
  // Durante el tour, el paso de línea es de elección libre (se puede deslizar): tocar una línea sólo
  // la selecciona; el avance lo dispara el botón "Elegir …" (abajo) → onb.next().
  const enTourLinea = onb.activo && onb.paso?.id === 'cfg-linea'
  function toggleConfigLock() {
    const next = !cfgBloqueado
    setCfgBloqueado(next)
    guardarConfigLock(next)
  }

  // Sync local state once settings load from DB
  useEffect(() => {
    if (!loaded) return
    setNombre(settings.nombreUsuario)
    setDiagrama(settings.diagrama)
    setDiagramaFecha(
      settings.diagramaInicioMs ? localDateStr(settings.diagramaInicioMs) : ''
    )
    setLinea(settings.lineaTrabajo)
    setConvenio(settings.convenio)
    setSueldoBasico(fmtBasicoDisplay(settings.sueldoBasico))
    setFechaIngreso(settings.fechaIngresoMs ? localDateStr(settings.fechaIngresoMs) : '')
    setTipoTurno(settings.tipoTurno)
    setZonaVM(settings.zonaVacaMuerta)
    setTasaDesarraigo(settings.tasaDesarraigo644)
    setBkCodigo(settings.backupCodigo)
    setBkBloqueado(settings.backupBloqueado)
    setDirty(false)
  }, [loaded]) // intentionally only on mount

  function flash(text: string, type: 'ok' | 'err' = 'ok') {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3000)
  }

  // Persiste TODA la configuración del formulario (sin avisos). Reutilizado por el botón y el auto-guardado.
  async function persistConfig() {
    const nuevoBasico = parseBasicoInput(sueldoBasico)
    // Si cambió el básico, lo anclamos a HOY para escalarlo por paritaria en otros meses.
    const basicoCambio = nuevoBasico !== settings.sueldoBasico
    await update({
      nombreUsuario: nombre,
      diagrama,
      diagramaInicioMs: diagramaFecha ? parseDateLocal(diagramaFecha) : 0,
      lineaTrabajo: linea,
      convenio,
      sueldoBasico: nuevoBasico,
      ...(basicoCambio ? { sueldoBasicoVigenciaMs: Date.now() } : {}),
      fechaIngresoMs: fechaIngreso ? parseDateLocal(fechaIngreso) : 0,
      tipoTurno,
      zonaVacaMuerta: zonaVM,
      tasaDesarraigo644: tasaDesarraigo,
    })
    setDirty(false)
  }

  async function handleGuardar() {
    try {
      await persistConfig()
      flash('Configuración guardada ✓')
    } catch {
      flash('Error al guardar. Intentá de nuevo.', 'err')
    }
  }

  // Auto-guardado: persiste los cambios del formulario (nombre, diagrama, inicio de diagrama,
  // línea, salario) poco después de cada edición — sin tener que tocar "Guardar". El código de
  // respaldo se guarda aparte (saveBackupCreds) y los feriados con su propio botón.
  useEffect(() => {
    if (!loaded || !dirty) return
    const t = setTimeout(() => { persistConfig().catch(() => {}) }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, nombre, diagrama, diagramaFecha, linea, convenio, sueldoBasico, fechaIngreso, tipoTurno, zonaVM, tasaDesarraigo])

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
      flash('Error: archivo inválido', 'err')
    }
    e.target.value = ''
  }

  // ── Respaldo en la nube ──────────────────────────────────────────────────
  // Persiste código + candado. También guarda el nombre del empleado, que ES el usuario del
  // respaldo, para que el auto-respaldo (que lee settings.nombreUsuario) use lo mismo.
  function saveBackupCreds(next: { codigo?: string; bloqueado?: boolean } = {}) {
    void update({
      nombreUsuario: nombre.trim(),
      backupCodigo: next.codigo ?? bkCodigo,
      backupBloqueado: next.bloqueado ?? bkBloqueado,
    })
  }

  // Genera un código de 6 dígitos, lo aplica y BLOQUEA (anti-cambios accidentales). Requiere nombre.
  function generarCodigo() {
    if (!nombre.trim()) return
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
    setBkCodigo(code)
    setBkBloqueado(true)
    saveBackupCreds({ codigo: code, bloqueado: true })
  }

  function toggleLock() {
    const next = !bkBloqueado
    setBkBloqueado(next)
    saveBackupCreds({ bloqueado: next })
  }

  async function handleRespaldarNube() {
    if (!credencialesNubeValidas(nombre, bkCodigo)) {
      flash('Completá tu nombre y un código de 6 dígitos', 'err')
      return
    }
    if (!quedanOperacionesNube()) {
      setLimiteMsg('Por hoy no se pueden hacer más respaldos. Intentá de nuevo mañana.')
      return
    }
    setCloudBusy(true)
    try {
      await subirBackupNube(nombre, bkCodigo, lineaLabel(linea))
      markCloudBackupDone()
      setCloudMs(0)
      flash('Respaldado en la nube ✓')
    } catch {
      flash('No se pudo respaldar. Revisá tu conexión.', 'err')
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleRestaurarNube() {
    setRestoreConfirm(false)
    if (!credencialesNubeValidas(nombre, bkCodigo)) {
      flash('Completá tu nombre y un código de 6 dígitos', 'err')
      return
    }
    if (!quedanOperacionesNube()) {
      setLimiteMsg('Por hoy no se pueden hacer más restauraciones. Intentá de nuevo mañana.')
      return
    }
    setCloudBusy(true)
    try {
      const r = await restaurarBackupNube(nombre, bkCodigo)
      if (r === 'ok') flash('Datos restaurados de la nube ✓')
      else if (r === 'no-existe') flash('No hay respaldo para ese usuario + código', 'err')
      else flash('Código incorrecto para ese usuario', 'err')
    } catch {
      flash('No se pudo restaurar. Revisá tu conexión.', 'err')
    } finally {
      setCloudBusy(false)
    }
  }

  function haceTexto(ms: number): string {
    if (!isFinite(ms)) return 'nunca'
    const d = Math.floor(ms / 86_400_000)
    if (d > 0) return `hace ${d} día${d > 1 ? 's' : ''}`
    const h = Math.floor(ms / 3_600_000)
    if (h > 0) return `hace ${h} h`
    const m = Math.floor(ms / 60_000)
    return m > 0 ? `hace ${m} min` : 'recién'
  }

  async function handleClearAll() {
    try {
      await clearAllRegistros()
      setDeleteStep(0)
      flash('Planilla borrada. Todos los registros fueron eliminados.')
    } catch {
      setDeleteStep(0)
      flash('Error al borrar. Intentá de nuevo.', 'err')
    }
  }

  async function handleActualizarFeriados() {
    setFeriadosBusy(true)
    try {
      const { total } = await actualizarFeriadosNacionales()
      setFeriadosUpd(feriadosActualizadoMs())
      flash(`Feriados nacionales actualizados ✓ (${total} fechas)`)
    } catch {
      flash('No se pudieron actualizar los feriados (¿sin conexión?). Se mantiene la lista actual.', 'err')
    } finally {
      setFeriadosBusy(false)
    }
  }

  if (!loaded) return <div className="text-center text-slate-500 py-12">Cargando…</div>

  return (
    <div className="min-h-screen bg-slate-900 pb-12">
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-4">
        <h1 className="text-lg font-bold text-white">Configuración</h1>
      </div>

      {msg && (
        <div className={`mx-4 mt-3 p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {backupOverdue && !msg && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-900/40 text-amber-300 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Tus datos no tienen respaldo. Activá el <strong>Respaldo en la nube</strong> (en Empleado, arriba) para que se guarden solos.</span>
        </div>
      )}

      <div className="px-4 py-4 space-y-6">
        {/* Empleado + respaldo en la nube — en su propio recuadro para separarlo del resto */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
        <Section title="Empleado">
          <Field label="Nombre completo">
            <input
              type="text"
              data-tour="cfg-nombre"
              value={nombre}
              disabled={bkBloqueado}
              onChange={e => { setNombre(e.target.value); setDirty(true) }}
              className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Ej: Juan Topo"
            />
            <p className="text-[11px] text-slate-500 mt-1">Se usa en la planilla, en el Excel exportado y en el respaldo en la nube.</p>
          </Field>
          {bkBloqueado && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Lock size={11} className="shrink-0" /> Nombre y código bloqueados. Tocá el candado para editarlos.
            </p>
          )}

          {/* Respaldo en la nube — MISMO bloque que el empleado; el usuario ES el nombre de arriba */}
          <p className="text-xs text-slate-400 leading-snug">
            <span className="font-semibold text-slate-300">Respaldo en la nube:</span> se guarda una copia
            cifrada con tu nombre + un código de 6 dígitos, sola cada pocos días al abrir la app.
          </p>

          <div data-tour="cfg-respaldo">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-400">Código de respaldo (6 dígitos)</label>
              {(bkBloqueado || !!bkCodigo) && (
                <button
                  onClick={toggleLock}
                  className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-lg ${bkBloqueado ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}
                >
                  {bkBloqueado ? <><Lock size={12} /> Bloqueado</> : <><Unlock size={12} /> Desbloqueado</>}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text" inputMode="numeric" value={bkCodigo} disabled={bkBloqueado || !nombre.trim()}
                onChange={e => setBkCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onBlur={() => saveBackupCreds()}
                placeholder={nombre.trim() ? '••••••' : 'completá tu nombre arriba'}
                className="flex-1 min-w-0 bg-slate-700 text-white rounded-xl px-3 py-2 text-sm font-mono tracking-[0.3em] disabled:opacity-50 disabled:cursor-not-allowed placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {!bkBloqueado && (
                <button onClick={generarCodigo} disabled={!nombre.trim()}
                  className={`shrink-0 px-3 rounded-xl text-xs font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none ${nombre.trim() && !bkCodigo ? 'generar-pulse bg-blue-600 text-white' : 'bg-slate-600 text-slate-200 active:bg-slate-500'}`}>
                  <Shuffle size={14} /> Generar
                </button>
              )}
            </div>
            <p className="text-[11px] text-amber-300/80 leading-snug flex items-start gap-1.5 mt-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              Tu nombre + este código son la llave del respaldo. Anotalos: si los perdés, no vas a poder restaurar en otro dispositivo.
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={handleRespaldarNube} disabled={cloudBusy || !nombre.trim() || !bkCodigo}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
              <Cloud size={16} /> Respaldar ahora
            </button>
            <button
              onClick={() => (restoreConfirm ? handleRestaurarNube() : setRestoreConfirm(true))}
              disabled={cloudBusy || !nombre.trim() || !bkCodigo}
              className={`flex-1 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 ${restoreConfirm ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200'}`}>
              <Download size={16} /> {restoreConfirm ? '¿Reemplazar todo?' : 'Restaurar de la nube'}
            </button>
          </div>
          {restoreConfirm && (
            <button onClick={() => setRestoreConfirm(false)} className="w-full text-xs text-slate-500 py-1">
              Cancelar restauración
            </button>
          )}

          <p className="text-xs text-slate-500 px-1">Último respaldo en la nube: {haceTexto(cloudMs)}.</p>
        </Section>
        </div>

        {/* Línea de trabajo — afecta el conteo de horas (visible para todos) */}
        <Section title="Línea de trabajo" action={<CandadoChip bloqueado={cfgBloqueado} onToggle={toggleConfigLock} />}>
          {!cfgEditable && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Lock size={11} className="shrink-0" /> Tocá el candado para cambiar la línea.
            </p>
          )}
          <div className="space-y-2" data-tour="cfg-linea">
            {LINEAS_TRABAJO.map(l => (
              <button
                key={l.key}
                onClick={() => { setLinea(l.key); setDirty(true) }}
                disabled={!cfgEditable}
                className={`w-full py-2.5 px-3 rounded-xl text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${linea === l.key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                <div className="text-sm font-medium">{l.label}</div>
                <div className={`text-xs mt-0.5 ${linea === l.key ? 'text-blue-100/80' : 'text-slate-400'}`}>{l.desc}</div>
              </button>
            ))}
            {enTourLinea && (
              <button
                onClick={() => onb.next()}
                className="mt-1 w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold active:bg-emerald-700"
              >
                Elegir "{lineaLabel(linea)}"
              </button>
            )}
          </div>
          {linea === 'SBDP' && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                <strong className="text-amber-300">Arreglo SBDP:</strong> cada día marcado como{' '}
                <strong>Campo</strong> (con o sin pernocte) cuenta <strong>12 h al 50%</strong> fijas y{' '}
                <strong>ninguna hora normal</strong>, sin importar cuántas se hayan cargado (6, 8, 12 o 16 hs).
                No afecta días Base, francos ni feriados; tampoco la planilla oficial (que muestra los horarios reales).
              </p>
            </div>
          )}
        </Section>

        {/* Salario y convenio — visible sólo para el usuario de prueba */}
        {isSalaryUser(nombre) && (
          <Section title="Salario y convenio">
            <Field label="Convenio">
              <div className="space-y-2">
                {CONVENIOS.map(c => (
                  <button
                    key={c.key}
                    onClick={() => { setConvenio(c.key); setDirty(true) }}
                    className={`w-full py-2.5 px-3 rounded-xl text-sm font-medium text-left transition-colors ${convenio === c.key ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Sueldo básico ($)">
              <input
                type="text"
                inputMode="decimal"
                value={sueldoBasico}
                onChange={e => { setSueldoBasico(formatBasicoInput(e.target.value)); setDirty(true) }}
                className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm"
                placeholder="Ej: 606.113,47"
              />
            </Field>

            <Field label="Fecha de ingreso (para antigüedad)">
              <input
                type="date"
                value={fechaIngreso}
                onChange={e => { setFechaIngreso(e.target.value); setDirty(true) }}
                className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm"
              />
            </Field>

            {convenio === 'CCT_644_12' && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 px-3 py-2.5 space-y-1">
                <p className="text-xs font-semibold text-slate-300">Adicionales del convenio (fijos)</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Servicios especiales (turno +33%) · Zona Vaca Muerta (+85%) · Desarraigo 20%.
                  Se aplican automáticamente: alcanza con cargar el sueldo básico.
                </p>
              </div>
            )}

            <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <Banknote size={13} className="text-slate-600 shrink-0 mt-0.5" />
              Las horas, viaje y nocturnas salen de la planilla. El detalle se ve en la pestaña Sueldo y el resumen en Análisis.
            </p>
          </Section>
        )}

        {/* Diagrama */}
        <Section title="Diagrama de trabajo" action={<CandadoChip bloqueado={cfgBloqueado} onToggle={toggleConfigLock} />}>
          {!cfgEditable && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Lock size={11} className="shrink-0" /> Tocá el candado para cambiar el diagrama o la fecha.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2" data-tour="cfg-diagrama">
            {DIAGRAMAS.map(d => (
              <button
                key={d.key}
                onClick={() => { setDiagrama(d.key); setDirty(true) }}
                disabled={!cfgEditable}
                className={`py-3 px-4 rounded-xl text-sm font-medium text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${diagrama === d.key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                <div className="font-bold">{d.label}</div>
                <div className="text-xs opacity-70 mt-0.5">{d.diasTrabajo} trabajo · {d.diasFranco} franco</div>
              </button>
            ))}
          </div>

          {diagrama !== 'LUNES_VIERNES' && (
            <Field label="Fecha inicio de diagrama">
              <input
                type="date"
                data-tour="cfg-fecha"
                value={diagramaFecha}
                disabled={!cfgEditable}
                onChange={e => { setDiagramaFecha(e.target.value); setDirty(true) }}
                className="w-full bg-slate-700 text-white rounded-xl px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </Field>
          )}
        </Section>

        {/* Guardar button */}
        <button
          data-tour="cfg-guardar"
          onClick={handleGuardar}
          disabled={!dirty}
          className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${dirty ? 'bg-blue-600 text-white active:bg-blue-700' : 'bg-slate-700/60 text-slate-400 cursor-default'}`}
        >
          {dirty ? 'Guardando…' : 'Cambios guardados ✓'}
        </button>

        {/* Feriados nacionales */}
        <Section title="Feriados nacionales">
          <p className="text-xs text-slate-400">
            Los feriados nacionales se detectan automáticamente: si trabajás uno, las horas van al 100%.
            No incluye feriados puente ni días no laborables (se pagan como día normal). Actualizá la lista
            para sumar años nuevos o aplicar correcciones oficiales.
          </p>
          <button
            data-tour="cfg-feriados"
            onClick={handleActualizarFeriados}
            disabled={feriadosBusy}
            className={`w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors ${feriadosBusy ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-700 text-slate-200 active:bg-slate-600'}`}
          >
            <CalendarDays size={16} /> {feriadosBusy ? 'Actualizando…' : 'Actualizar feriados nacionales'}
          </button>
          {feriadosUpd > 0 && (
            <p className="text-xs text-slate-500 px-1">
              Última actualización: {new Date(feriadosUpd).toLocaleDateString('es-AR')}
            </p>
          )}
        </Section>

        {/* Instalar app */}
        <InstallSection />

        {/* Proyectos frecuentes */}
        <Section title="Proyectos frecuentes">
          <ProyectosEditor
            proyectos={settings.proyectosFrecuentes}
            onChange={proyectosFrecuentes => update({ proyectosFrecuentes })}
          />
        </Section>

        {/* Exportar / importar datos — backup manual a archivo; el respaldo principal es la nube */}
        <Section title="Exportar / importar datos">
          <div className="flex gap-2">
            <button onClick={handleExportBackup}
              className="flex-1 py-2.5 rounded-xl bg-slate-700/70 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 active:bg-slate-600">
              <Download size={14} /> Exportar
            </button>
            <label className="flex-1">
              <span className="w-full py-2.5 rounded-xl bg-slate-700/70 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-slate-600">
                <FolderOpen size={14} /> Importar
              </span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
          </div>
          <p className="text-[11px] text-slate-500 px-1">
            Backup manual a un archivo. Importar reemplaza TODOS los datos. El respaldo automático es el de la nube (arriba).
          </p>
        </Section>

        {/* Advertencia de almacenamiento */}
        <StorageWarningBanner />

        {/* Zona de peligro */}
        <Section title="Zona de peligro">
          {deleteStep === 0 && (
            <button
              onClick={() => setDeleteStep(1)}
              className="w-full py-3 rounded-xl bg-red-900/20 text-red-400 border border-red-800/40 text-sm font-medium flex items-center justify-center gap-2 active:bg-red-900/40 transition-colors"
            >
              <Trash2 size={16} /> Borrar planilla
            </button>
          )}

          {deleteStep === 1 && (
            <div className="rounded-xl border border-red-800/50 bg-red-900/20 p-4 space-y-3">
              <p className="text-sm font-semibold text-red-300 flex items-center gap-2">
                <AlertTriangle size={15} /> ¿Borrar toda la planilla?
              </p>
              <p className="text-xs text-slate-400">Se eliminarán todos los registros de horas. Esta acción no se puede deshacer.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteStep(0)} className="flex-1 py-2.5 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={() => setDeleteStep(2)} className="flex-1 py-2.5 rounded-xl bg-red-700/60 text-red-200 text-sm font-medium border border-red-600/40">
                  Sí, borrar →
                </button>
              </div>
            </div>
          )}

          {deleteStep === 2 && (
            <div className="rounded-xl border border-red-600/70 bg-red-900/30 p-4 space-y-3">
              <p className="text-sm font-bold text-red-300 flex items-center gap-2">
                <AlertTriangle size={15} /> Última confirmación
              </p>
              <p className="text-xs text-slate-300">Todos los registros se borrarán definitivamente. No hay forma de recuperarlos si no tenés un backup.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteStep(0)} className="flex-1 py-2.5 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleClearAll} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold active:bg-red-700 transition-colors">
                  Borrar definitivamente
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-600 px-1">Los registros con más de 6 meses se eliminan automáticamente al abrir la app.</p>
        </Section>

        {/* Créditos */}
        <div className="pt-4 pb-2 text-center space-y-0.5">
          <p className="text-xs text-slate-500">Planilla de Horas</p>
          <p className="text-xs text-slate-600">
            Desarrollado por <span className="text-slate-400 font-medium">Nicolas Vazquez</span>{' '}
            <span className="text-slate-500">{KAOMOJI}</span>
          </p>
          <p className="text-[10px] text-slate-600">
            versión {APP_VERSION} · build {new Date(__BUILD_TIME__).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Modal de tope diario de operaciones de nube (respaldar/restaurar) */}
      {limiteMsg && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={() => setLimiteMsg(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-slate-800 p-5 shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-2">
              <AlertTriangle size={18} className="text-amber-400 shrink-0" />
              <h2 className="text-base font-bold text-white leading-tight">Límite diario alcanzado</h2>
            </div>
            <p className="text-sm text-slate-300 leading-snug">{limiteMsg}</p>
            <button
              onClick={() => setLimiteMsg(null)}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-700 text-slate-200 text-sm font-medium active:bg-slate-600"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InstallSection() {
  const { canInstall, install, isInstalled, isIOS } = usePWAInstall()

  if (isInstalled) return null

  const ua = navigator.userAgent
  const isAndroid = /android/i.test(ua)
  const isFirefox = /firefox/i.test(ua)

  return (
    <Section title="Instalar app">
      {canInstall ? (
        <button
          onClick={install}
          className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-2 active:bg-blue-700 transition-colors"
        >
          <Smartphone size={16} /> Instalar en este dispositivo
        </button>
      ) : isIOS ? (
        <div className="bg-slate-700/50 rounded-xl p-3 text-sm text-slate-300 space-y-2">
          <p className="font-semibold text-white flex items-center gap-2">
            <Smartphone size={15} className="text-blue-400" /> Agregar a pantalla de inicio
          </p>
          <p>1. Tocá el ícono de <span className="text-blue-300 font-medium">Compartir</span> (cuadrado con flecha ↑) en la barra de Safari</p>
          <p>2. Elegí <span className="text-blue-300 font-medium">"Agregar a pantalla de inicio"</span></p>
        </div>
      ) : isAndroid && isFirefox ? (
        <div className="bg-slate-700/50 rounded-xl p-3 text-sm text-slate-300 space-y-2">
          <p className="font-semibold text-white flex items-center gap-2">
            <Smartphone size={15} className="text-blue-400" /> Agregar a pantalla de inicio (Firefox)
          </p>
          <p>1. Tocá el menú <span className="text-blue-300 font-medium">⋮</span> de Firefox (tres puntos abajo a la derecha)</p>
          <p>2. Tocá <span className="text-blue-300 font-medium">"Instalar"</span> o andá a <span className="text-blue-300 font-medium">Más → "Añadir a pantalla de inicio"</span></p>
          <p className="text-xs text-slate-500">Si no ves la opción, intentá con Chrome para una mejor experiencia de instalación.</p>
        </div>
      ) : isAndroid ? (
        <div className="bg-slate-700/50 rounded-xl p-3 text-sm text-slate-300 space-y-2">
          <p className="font-semibold text-white flex items-center gap-2">
            <Smartphone size={15} className="text-blue-400" /> Agregar a pantalla de inicio
          </p>
          <p>1. Tocá el menú <span className="text-blue-300 font-medium">⋮</span> de Chrome (tres puntos arriba a la derecha)</p>
          <p>2. Elegí <span className="text-blue-300 font-medium">"Agregar a pantalla de inicio"</span></p>
          <p className="text-xs text-slate-500">Si no aparece esa opción, recargá la página un par de veces.</p>
        </div>
      ) : (
        <div className="bg-slate-700/50 rounded-xl p-3 text-sm text-slate-300 space-y-2">
          <p className="font-semibold text-white flex items-center gap-2">
            <Smartphone size={15} className="text-blue-400" /> Instalar en PC
          </p>
          <p>Buscá el ícono <span className="text-blue-300 font-medium">⊕</span> en la barra de dirección de Chrome, o andá al menú → <span className="text-blue-300 font-medium">"Guardar e instalar"</span></p>
        </div>
      )}
    </Section>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider">{title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// Chip de candado para bloquear/desbloquear la configuración de trabajo (mismo estilo que el del
// código de respaldo). Bloqueado = verde (protegido); desbloqueado = ámbar (editable, ojo).
function CandadoChip({ bloqueado, onToggle }: { bloqueado: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex shrink-0 items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-lg ${bloqueado ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}
      aria-label={bloqueado ? 'Desbloquear para editar' : 'Bloquear para evitar cambios'}
    >
      {bloqueado ? <><Lock size={12} /> Bloqueado</> : <><Unlock size={12} /> Desbloqueado</>}
    </button>
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
        <span className="text-lg"><AlertTriangle size={18} className="text-amber-400" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-300">Consideraciones sobre tus datos</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            Almacenamiento local · Respaldo en la nube disponible
          </p>
        </div>
        <span className="text-slate-500 ml-2">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
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
                <span><strong className="text-slate-200">Respaldo en la nube</strong> (opcional) — si lo activás, además se guarda una copia cifrada en la nube cada pocos días, recuperable con tu nombre + código.</span>
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
                <span>No hay sincronización en vivo: entre dispositivos se pasa restaurando el Respaldo en la nube (con tu nombre + código).</span>
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
                <span><strong className="text-slate-200">Activar el Respaldo en la nube</strong> (en Empleado): se respalda solo cada pocos días, sin manejar archivos.</span>
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
            <button onClick={() => onChange(proyectos.filter(x => x !== p))} className="text-slate-500 hover:text-red-400 p-0.5"><X size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
