import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Users, Heart, Sparkles, Search, X, Cloud, Activity, AlertTriangle, FileSpreadsheet, Power, Megaphone, Send, History, Eraser, Eye, LayoutDashboard, Lightbulb, Copy, Check, Banknote, KeyRound, LogOut } from 'lucide-react'
import { listarPadronNube, leerUsoFirebase, leerConfigNube, setBeggarActivo, enviarDifusion, listarDifusiones, limpiarDifusion, enviarMensajeIndividual, leerRecepcionMensaje, setBeggarUsuario, setSalaryUnlockUsuario, listarSugerencias, listarNetosNube, asegurarAuthAdmin, adminUidActual, refrescarTokenAdmin, logoutAdmin, asegurarCodigoAdmin, ADMIN_UID_ESPERADO, type PadronEntry, type UsoFirebase, type AppConfig, type DifusionEntry, type MensajeIndividual, type SugerenciaEntry, type NetoEntry } from '../lib/cloud-backup'
import { fmtPesos } from '../lib/calculo-salarial'
import { APP_VERSION } from '../version'

const ACTIVO_MS = 7 * 24 * 60 * 60 * 1000 // "activo" = respaldó en los últimos 7 días
const SIN_LINEA = '(sin línea)'
const SIN_VERSION = '(?)'

type AdminTab = 'resumen' | 'usuarios' | 'difusion' | 'sugerencias'

// Marca local de la sugerencia más nueva ya vista por el admin → para el badge de "nuevas".
const SUG_SEEN_KEY = 'planilla-admin-sug-seen'
function leerSugVistas(): number {
  try { return Number(localStorage.getItem(SUG_SEEN_KEY) || 0) } catch { return 0 }
}
function guardarSugVistas(ms: number): void {
  try { localStorage.setItem(SUG_SEEN_KEY, String(ms)) } catch { /* ignore */ }
}

/** Tiempo relativo corto desde un timestamp (para "última actividad"). */
function hace(ms: number): string {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 0) return 'recién'
  const min = Math.floor(d / 60_000)
  if (min < 2) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  return `hace ${dias} día${dias > 1 ? 's' : ''}`
}

/** Cuenta regresiva hasta el reinicio del tope diario (medianoche local). */
function fmtReset(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

/** Pesos en formato compacto para chips angostos: $2,1M / $850k / $999. */
function fmtPesosCompact(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1_000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n)
}

/** Agrupa por una clave y devuelve [clave, cantidad] de mayor a menor. */
function agrupar(list: PadronEntry[], key: (e: PadronEntry) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const e of list) {
    const k = key(e)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const lineaDe = (e: PadronEntry) => e.linea || SIN_LINEA
const versionDe = (e: PadronEntry) => e.version || SIN_VERSION

export function AdminPage({ onLogout }: { onLogout: () => void }) {
  const [padron, setPadron] = useState<PadronEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Filtros dinámicos
  const [q, setQ] = useState('')
  const [lineasSel, setLineasSel] = useState<Set<string>>(new Set())
  const [versionesSel, setVersionesSel] = useState<Set<string>>(new Set())
  const [soloActivos, setSoloActivos] = useState(false)
  // Medidor de uso GLOBAL de Firebase (todos los usuarios), se refresca junto con el padrón
  const [uso, setUso] = useState<UsoFirebase | null>(null)
  // Acciones globales: config (donador on/off + difusión actual) e historial de difusiones.
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [difusiones, setDifusiones] = useState<DifusionEntry[]>([])
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  // Confirmación en curso ('beggar' | 'difusion' | 'limpiar') y estado de envío.
  const [accion, setAccion] = useState<null | 'beggar' | 'difusion' | 'limpiar'>(null)
  const [enviando, setEnviando] = useState(false)
  // Usuario seleccionado para enviarle un mensaje individual (abre MensajeModal).
  const [msgUser, setMsgUser] = useState<PadronEntry | null>(null)
  // Pestaña activa + sugerencias recibidas + marca de "nuevas vistas" (badge).
  const [tab, setTab] = useState<AdminTab>('resumen')
  const [sugerencias, setSugerencias] = useState<SugerenciaEntry[]>([])
  const [sugVistas, setSugVistas] = useState(leerSugVistas)
  // Netos estimados por usuario (privado, sólo-admin). Mapa docId → neto para cruzar con el padrón.
  const [netos, setNetos] = useState<NetoEntry[]>([])

  async function cargar() {
    setBusy(true); setErr(null)
    try {
      const [list, u] = await Promise.all([listarPadronNube(), leerUsoFirebase()])
      list.sort((a, b) => b.updatedAt - a.updatedAt)
      setPadron(list)
      setUso(u)
    } catch {
      setErr('No se pudo leer el padrón. ¿Publicaste las reglas de Firestore para "padron" y "uso"?')
    } finally {
      setBusy(false)
    }
    // Config + historial + sugerencias: independientes del padrón (si fallan sus reglas, no rompen el resto).
    try { setConfig(await leerConfigNube()) } catch { /* ignore */ }
    try { setDifusiones(await listarDifusiones()) } catch { /* ignore */ }
    try { setSugerencias(await listarSugerencias()) } catch { /* ignore */ }
    // Netos: lectura SÓLO-admin → primero aseguramos la sesión Firebase Auth (puede no estar restaurada
    // al montar), si no la lectura iría sin token y las reglas la rechazarían.
    try { await asegurarAuthAdmin(); setNetos(await listarNetosNube()) } catch { /* reglas de "netos" sin publicar o sin sesión admin */ }
  }
  useEffect(() => { void cargar() }, [])

  // Sugerencias más nuevas que la última vista → badge. Al entrar a la pestaña, se marcan como vistas.
  const sugNuevas = useMemo(() => sugerencias.filter(s => s.createdAt > sugVistas).length, [sugerencias, sugVistas])
  useEffect(() => {
    if (tab !== 'sugerencias' || sugerencias.length === 0) return
    const masNueva = Math.max(...sugerencias.map(s => s.createdAt))
    if (masNueva > sugVistas) { guardarSugVistas(masNueva); setSugVistas(masNueva) }
  }, [tab, sugerencias, sugVistas])

  // Activa/desactiva el donador para todos (tras la doble confirmación).
  async function confirmarBeggar() {
    if (!config) return
    setEnviando(true)
    try {
      const nuevo = !config.beggarActivo
      await setBeggarActivo(nuevo)
      setConfig({ ...config, beggarActivo: nuevo })
      setAccion(null)
    } catch {
      alert('No se pudo cambiar el donador. ¿Publicaste las reglas de Firestore para "config"?')
    } finally {
      setEnviando(false)
    }
  }

  // Envía el mensaje de difusión a todos (tras la doble confirmación).
  async function confirmarDifusion() {
    setEnviando(true)
    try {
      const entry = await enviarDifusion(titulo, cuerpo)
      setDifusiones(d => [entry, ...d])
      setConfig(c => c ? { ...c, difusionId: entry.id, difusionTitulo: entry.titulo, difusionCuerpo: entry.cuerpo, difusionCreatedAt: entry.createdAt } : c)
      setTitulo(''); setCuerpo(''); setAccion(null)
    } catch {
      alert('No se pudo enviar. ¿Publicaste las reglas de Firestore para "config" y "difusion"?')
    } finally {
      setEnviando(false)
    }
  }

  // Limpia la difusión actual (deja de mostrarse; no borra el historial).
  async function confirmarLimpiar() {
    setEnviando(true)
    try {
      await limpiarDifusion()
      setConfig(c => c ? { ...c, difusionId: '', difusionTitulo: '', difusionCuerpo: '', difusionCreatedAt: 0 } : c)
      setAccion(null)
    } catch {
      alert('No se pudo limpiar. ¿Publicaste las reglas de Firestore para "config"?')
    } finally {
      setEnviando(false)
    }
  }

  const all = padron ?? []

  const lineasDisp = useMemo(() => [...new Set(all.map(lineaDe))].sort((a, b) => a.localeCompare(b, 'es')), [all])
  const versionesDisp = useMemo(() => [...new Set(all.map(versionDe))].sort().reverse(), [all])

  const filtrado = useMemo(() => {
    const qn = q.trim().toLowerCase()
    const ahora = Date.now()
    return all.filter(e => {
      if (qn && !e.nombre.toLowerCase().includes(qn)) return false
      if (lineasSel.size && !lineasSel.has(lineaDe(e))) return false
      if (versionesSel.size && !versionesSel.has(versionDe(e))) return false
      if (soloActivos && ahora - e.updatedAt > ACTIVO_MS) return false
      return true
    })
  }, [all, q, lineasSel, versionesSel, soloActivos])

  const totalDon = filtrado.reduce((s, e) => s + (e.donaciones ?? 0), 0)
  const totalGra = filtrado.reduce((s, e) => s + (e.gracias ?? 0), 0)
  const totalExp = filtrado.reduce((s, e) => s + (e.exportaciones ?? 0), 0)
  // Difusión actual + cuántos la vieron (según su último respaldo). '' = no hay difusión activa.
  const difusionActivaId = config?.difusionId ?? ''
  const vieronDifusion = difusionActivaId ? filtrado.filter(e => e.difusionVista === difusionActivaId).length : 0
  const activos = useMemo(() => filtrado.filter(e => Date.now() - e.updatedAt <= ACTIVO_MS).length, [filtrado])
  const desactualizados = useMemo(() => filtrado.filter(e => e.version && e.version !== APP_VERSION).length, [filtrado])
  const porLinea = useMemo(() => agrupar(filtrado, lineaDe), [filtrado])
  const porVersion = useMemo(() => agrupar(filtrado, versionDe), [filtrado])

  // Netos: mapa docId → neto + lista cruzada con el padrón filtrado (sólo usuarios que subieron neto).
  const netosById = useMemo(() => new Map(netos.map(n => [n.id, n])), [netos])
  const netosFiltrados = useMemo(
    () => filtrado
      .map(e => (e.id ? netosById.get(e.id) : undefined))
      .filter((n): n is NetoEntry => !!n)
      .sort((a, b) => b.neto - a.neto),
    [filtrado, netosById],
  )
  const totalNeto = netosFiltrados.reduce((s, n) => s + n.neto, 0)

  const hayFiltro = !!q.trim() || lineasSel.size > 0 || versionesSel.size > 0 || soloActivos
  function limpiar() { setQ(''); setLineasSel(new Set()); setVersionesSel(new Set()); setSoloActivos(false) }

  return (
    <div className="min-h-screen bg-slate-900 pb-12">
      {/* Header + pestañas (sticky): cortan el scroll infinito y agrupan por tarea. */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="px-4 pt-4 pb-2.5 flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Admin</h1>
          <button
            onClick={cargar}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg px-3 py-1.5 active:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Cargando…' : 'Refrescar'}
          </button>
        </div>
        <div className="flex gap-1 px-2 pb-1.5 overflow-x-auto">
          <TabBtn active={tab === 'resumen'} label="Resumen" icon={<LayoutDashboard size={14} />} onClick={() => setTab('resumen')} />
          <TabBtn active={tab === 'usuarios'} label="Usuarios" icon={<Users size={14} />} badge={all.length || undefined} onClick={() => setTab('usuarios')} />
          <TabBtn active={tab === 'difusion'} label="Difusión" icon={<Megaphone size={14} />} onClick={() => setTab('difusion')} />
          <TabBtn active={tab === 'sugerencias'} label="Sugerencias" icon={<Lightbulb size={14} />} badge={sugNuevas || undefined} onClick={() => setTab('sugerencias')} />
        </div>
      </div>

      <div key={tab} className="px-4 py-4 space-y-4 animate-[view-fade-in_180ms_ease_both]">
        {err && (
          <div className="p-3 rounded-xl bg-red-900/40 text-red-300 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{err}</span>
          </div>
        )}

        {/* ─── RESUMEN: uso de Firebase + métricas + gráficos ─── */}
        {tab === 'resumen' && (
          <>
            {/* Diagnóstico de la sesión admin: muestra el UID logueado vs el de las reglas y permite
                refrescar el token o cerrar sesión (única salida de admin de la app). */}
            <SesionAdminCard onLogout={onLogout} />

            {uso && (
              <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white flex items-center gap-1.5"><Cloud size={15} /> Uso de Firebase hoy (todos)</span>
                  <span className="text-[11px] text-slate-400">reinicia en {fmtReset(uso.resetEnMs)}</span>
                </div>
                <UsoBar label="Lecturas" usado={uso.reads} tope={uso.quotaReads} />
                <UsoBar label="Escrituras" usado={uso.writes} tope={uso.quotaWrites} />
                <p className="text-[10px] text-slate-500">Estimado: suma las operaciones de todos los dispositivos. La cuota gratis reinicia a la medianoche del Pacífico.</p>
              </div>
            )}

            {/* Si hay un filtro activo (se setea en la pestaña Usuarios), los números lo reflejan: aviso + limpiar. */}
            {hayFiltro && (
              <button onClick={limpiar} className="w-full flex items-center justify-between gap-2 rounded-xl border border-blue-700/40 bg-blue-950/40 px-3 py-2 text-[11px] text-blue-200 active:bg-blue-900/40">
                <span>Mostrando datos filtrados ({filtrado.length} de {all.length})</span>
                <span className="flex items-center gap-1 font-medium"><X size={12} /> Limpiar</span>
              </button>
            )}

            {/* Tarjetas de métricas (reflejan el filtro) */}
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={<Users size={15} />} valor={filtrado.length} label={filtrado.length === 1 ? 'usuario' : 'usuarios'} sub={`${activos} activos (7 d)`} color="text-white" />
              <Stat icon={<Activity size={15} />} valor={desactualizados} label="desactualizados" sub={`última: v${APP_VERSION}`} color="text-amber-300" />
              <Stat icon={<FileSpreadsheet size={15} />} valor={totalExp} label="exportaciones" color="text-emerald-300" />
              <Stat icon={<Heart size={15} />} valor={totalDon} label="toques a donar" color="text-pink-300" />
              <Stat icon={<Sparkles size={15} />} valor={totalGra} label='veces "gracias"' color="text-amber-300" />
              <Stat icon={<Eye size={15} />} valor={vieronDifusion} label="vieron difusión" sub={difusionActivaId ? `de ${filtrado.length}` : 'sin difusión activa'} color="text-sky-300" />
            </div>

            {netosFiltrados.length > 0 && <NetosCard netos={netosFiltrados} total={totalNeto} />}

            {filtrado.length > 0 && (
              <>
                <Grafico titulo="Usuarios por línea"><Barras datos={porLinea} color="#38bdf8" /></Grafico>
                <Grafico titulo="Usuarios por versión"><Barras datos={porVersion} color="#a78bfa" /></Grafico>
              </>
            )}
          </>
        )}

        {/* ─── USUARIOS: filtros + lista ─── */}
        {tab === 'usuarios' && (
          <>
            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filtros</span>
                {hayFiltro && (
                  <button onClick={limpiar} className="text-[11px] text-blue-300 active:text-blue-200 flex items-center gap-1">
                    <X size={12} /> Limpiar
                  </button>
                )}
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Buscar por nombre…"
                  className="w-full bg-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {lineasDisp.length > 0 && (
                <ChipRow titulo="Línea" valores={lineasDisp} sel={lineasSel} onToggle={v => setLineasSel(toggle(lineasSel, v))} />
              )}
              {versionesDisp.length > 0 && (
                <ChipRow titulo="Versión" valores={versionesDisp} sel={versionesSel} onToggle={v => setVersionesSel(toggle(versionesSel, v))} />
              )}
              <button
                onClick={() => setSoloActivos(v => !v)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-lg ${soloActivos ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}
              >
                Solo activos (7 días)
              </button>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">
                Lista {hayFiltro && <span className="text-slate-400">({filtrado.length} de {all.length})</span>}
              </p>
              {padron === null ? (
                <p className="text-sm text-slate-500 py-6 text-center">Cargando…</p>
              ) : filtrado.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">{all.length === 0 ? 'Todavía no hay usuarios en el padrón.' : 'Ningún usuario coincide con el filtro.'}</p>
              ) : (
                <div className="space-y-1">
                  {filtrado.map((e, i) => {
                    const vieja = e.version && e.version !== APP_VERSION
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 bg-slate-700/40 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-200 truncate">{e.nombre || '(sin nombre)'}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {e.linea || '—'} · <span className={vieja ? 'text-amber-400' : 'text-slate-500'}>v{e.version || '?'}</span> · {hace(e.updatedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[11px] tabular-nums">
                          {e.id && netosById.get(e.id) && <span className="flex items-center gap-0.5 text-teal-300 font-semibold" title={`Neto estimado: ${fmtPesos(netosById.get(e.id)!.neto)} · proyectado: ${fmtPesos(netosById.get(e.id)!.proyectado)}`}><Banknote size={11} /> {fmtPesosCompact(netosById.get(e.id)!.neto)}</span>}
                          {difusionActivaId !== '' && e.difusionVista === difusionActivaId && <span className="flex items-center text-sky-300" title="Vio la última difusión"><Eye size={11} /></span>}
                          {(e.exportaciones ?? 0) > 0 && <span className="flex items-center gap-0.5 text-emerald-300"><FileSpreadsheet size={11} /> {e.exportaciones}</span>}
                          {(e.donaciones ?? 0) > 0 && <span className="flex items-center gap-0.5 text-pink-300"><Heart size={11} /> {e.donaciones}</span>}
                          {(e.gracias ?? 0) > 0 && <span className="flex items-center gap-0.5 text-amber-300"><Sparkles size={11} /> {e.gracias}</span>}
                          {e.id && <button onClick={() => setMsgUser(e)} className="ml-0.5 flex items-center text-slate-400 active:text-emerald-300" title="Enviar mensaje a este usuario"><Send size={13} /></button>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── DIFUSIÓN: donador on/off + mensaje a todos + historial ─── */}
        {tab === 'difusion' && (
          <AdminAcciones
            config={config}
            difusiones={difusiones}
            titulo={titulo} setTitulo={setTitulo}
            cuerpo={cuerpo} setCuerpo={setCuerpo}
            onToggleBeggar={() => setAccion('beggar')}
            onEnviar={() => setAccion('difusion')}
            onLimpiar={() => setAccion('limpiar')}
          />
        )}

        {/* ─── SUGERENCIAS: historial + filtros ─── */}
        {tab === 'sugerencias' && (
          <SugerenciasPanel sugerencias={sugerencias} cargando={busy && sugerencias.length === 0} sugVistas={sugVistas} />
        )}
      </div>

      {/* Confirmaciones dobles (afectan a TODOS los usuarios) */}
      {accion === 'beggar' && config && (
        <ConfirmDoble
          titulo={config.beggarActivo ? 'Desactivar el donador para todos' : 'Activar el donador para todos'}
          detalle={config.beggarActivo
            ? 'El personaje que pide donaciones dejará de aparecer para todos los usuarios.'
            : 'El personaje que pide donaciones volverá a aparecer (al exportar) para todos los usuarios.'}
          etiquetaConfirmar={config.beggarActivo ? 'Desactivar' : 'Activar'}
          peligro={config.beggarActivo}
          enviando={enviando}
          onCancel={() => setAccion(null)}
          onConfirm={confirmarBeggar}
        />
      )}
      {accion === 'difusion' && (
        <ConfirmDoble
          titulo="Enviar mensaje a todos"
          detalle={`Se mostrará UNA sola vez a cada usuario:\n\n"${titulo.trim() || '(sin título)'}"\n${cuerpo.trim() || '(sin texto)'}`}
          etiquetaConfirmar="Enviar a todos"
          enviando={enviando}
          onCancel={() => setAccion(null)}
          onConfirm={confirmarDifusion}
        />
      )}
      {accion === 'limpiar' && (
        <ConfirmDoble
          titulo="Limpiar difusión actual"
          detalle="El mensaje actual deja de mostrarse a los usuarios que todavía no lo vieron. El historial se conserva y podés volver a enviar cuando quieras."
          etiquetaConfirmar="Limpiar"
          pasos={1}
          enviando={enviando}
          onCancel={() => setAccion(null)}
          onConfirm={confirmarLimpiar}
        />
      )}

      {msgUser && <MensajeModal user={msgUser} onClose={() => setMsgUser(null)} />}
    </div>
  )
}

/** Modal para enviarle un mensaje INDIVIDUAL a un usuario del padrón (le aparece como difusión
 *  dirigida). Muestra el acuse del último mensaje ("Recibido hace X / aún sin recibir"). */
function MensajeModal({ user, onClose }: { user: PadronEntry; onClose: () => void }) {
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [actual, setActual] = useState<MensajeIndividual | null | undefined>(undefined) // undefined = cargando
  const [enviando, setEnviando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [beggarBusy, setBeggarBusy] = useState(false)
  const [salaryBusy, setSalaryBusy] = useState(false)
  const [confirmSalary, setConfirmSalary] = useState(false)

  useEffect(() => {
    void (async () => {
      if (!user.id) { setActual(null); return }
      try { setActual(await leerRecepcionMensaje(user.id)) } catch { setActual(null) }
    })()
  }, [user.id])

  async function enviar() {
    if (!user.id) return
    setEnviando(true)
    try {
      const m = await enviarMensajeIndividual(user.id, titulo, cuerpo)
      setActual(prev => ({ ...m, beggar: prev?.beggar })) // preservar el flag del donador
      setTitulo(''); setCuerpo(''); setConfirmar(false); setEnviado(true)
    } catch {
      alert('No se pudo enviar. ¿Publicaste las reglas de Firestore para "mensajes"?')
    } finally {
      setEnviando(false)
    }
  }

  // Activa/desactiva el donador SÓLO para este usuario (aunque esté apagado para todos).
  async function toggleBeggar() {
    if (!user.id || actual === undefined) return
    const nuevo = !actual?.beggar
    setBeggarBusy(true)
    try {
      await setBeggarUsuario(user.id, nuevo)
      setActual(a => ({ ...(a ?? { id: user.id!, titulo: '', cuerpo: '', createdAt: 0, recibidoAt: 0 }), beggar: nuevo }))
    } catch {
      alert('No se pudo cambiar. ¿Publicaste las reglas de Firestore para "mensajes"?')
    } finally {
      setBeggarBusy(false)
    }
  }

  // Habilita/deshabilita la proyección salarial SÓLO para este usuario. Activar pide doble confirmación
  // (es info sensible); desactivar es directo.
  async function aplicarSalary(nuevo: boolean) {
    if (!user.id || actual === undefined) return
    setSalaryBusy(true)
    try {
      await setSalaryUnlockUsuario(user.id, nuevo)
      setActual(a => ({ ...(a ?? { id: user.id!, titulo: '', cuerpo: '', createdAt: 0, recibidoAt: 0 }), salaryUnlock: nuevo }))
      setConfirmSalary(false)
    } catch {
      alert('No se pudo cambiar. ¿Publicaste las reglas de Firestore para "mensajes"?')
    } finally {
      setSalaryBusy(false)
    }
  }

  const puede = titulo.trim().length > 0 || cuerpo.trim().length > 0
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60" onClick={enviando ? undefined : onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-white flex items-center gap-1.5 min-w-0"><Send size={15} className="shrink-0" /> <span className="truncate">Mensaje a {user.nombre || '(sin nombre)'}</span></p>
          <button onClick={onClose} className="shrink-0 text-slate-400 active:text-slate-200"><X size={16} /></button>
        </div>

        {/* Acuse del último mensaje a este usuario */}
        {actual === undefined ? (
          <p className="text-[11px] text-slate-500">Cargando estado…</p>
        ) : actual ? (
          <div className="rounded-lg border border-slate-700 bg-slate-700/30 px-3 py-2 text-[11px] space-y-0.5">
            <p className="text-slate-300 truncate"><span className="text-slate-500">Último:</span> {actual.titulo || '(sin título)'}</p>
            <p className={actual.recibidoAt ? 'text-emerald-300' : 'text-amber-300'}>
              {actual.recibidoAt ? `Recibido ${hace(actual.recibidoAt)} ✓` : 'Enviado · todavía sin recibir'}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Todavía no le enviaste ningún mensaje.</p>
        )}

        {/* Donador para ESTE usuario (independiente del toggle global) */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-600/60 bg-slate-700/30 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white flex items-center gap-1.5"><Power size={13} className="shrink-0" /> Donador para este usuario</p>
            <p className="text-[11px] text-slate-500">{actual === undefined ? 'Cargando…' : actual?.beggar ? 'Activado: le aparece el pedido de donación.' : 'Apagado para este usuario.'}</p>
          </div>
          <button
            onClick={toggleBeggar}
            disabled={!user.id || beggarBusy || actual === undefined}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${actual?.beggar ? 'bg-emerald-500' : 'bg-slate-600'}`}
            aria-label="Activar o desactivar el donador para este usuario"
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${actual?.beggar ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Proyección salarial para ESTE usuario (activar pide doble confirmación) */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-600/60 bg-slate-700/30 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white flex items-center gap-1.5"><Banknote size={13} className="shrink-0" /> Proyección salarial para este usuario</p>
            <p className={`text-[11px] ${actual?.salaryConflict ? 'text-amber-300' : 'text-slate-500'}`}>
              {actual === undefined ? 'Cargando…'
                : actual?.salaryConflict ? '⚠ Revocada: se usó en otro teléfono. Reactivá para dar el alta de nuevo.'
                : actual?.salaryUnlock ? (actual?.salaryDeviceId ? 'Habilitada y vinculada a un dispositivo.' : 'Habilitada: esperando que el dispositivo la reclame.')
                : 'Deshabilitada para este usuario.'}
            </p>
          </div>
          <button
            onClick={() => { if (actual?.salaryUnlock) void aplicarSalary(false); else setConfirmSalary(true) }}
            disabled={!user.id || salaryBusy || actual === undefined}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${actual?.salaryUnlock ? 'bg-emerald-500' : 'bg-slate-600'}`}
            aria-label="Habilitar o deshabilitar la proyección salarial para este usuario"
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${actual?.salaryUnlock ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {enviado && <p className="text-[11px] text-emerald-300">Mensaje enviado. Le va a aparecer la próxima vez que abra la app; acá vas a ver el acuse cuando lo reciba.</p>}

        <input
          value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={60}
          placeholder="Título (ej. AVISO)"
          className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <textarea
          value={cuerpo} onChange={e => setCuerpo(e.target.value)} maxLength={400} rows={3}
          placeholder="Mensaje para este usuario…"
          className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500 tabular-nums">{cuerpo.length}/400</span>
          <button
            onClick={() => setConfirmar(true)} disabled={!puede || enviando}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white active:bg-emerald-700 disabled:opacity-40"
          >
            <Send size={13} /> Enviar
          </button>
        </div>

        {confirmar && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-2.5">
            <p className="text-xs text-emerald-100">¿Enviar este mensaje SOLO a <b>{user.nombre || '(sin nombre)'}</b>?</p>
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setConfirmar(false)} disabled={enviando} className="px-3 py-1.5 text-xs font-medium text-slate-300 rounded-lg bg-slate-700 active:bg-slate-600 disabled:opacity-50">No</button>
              <button onClick={enviar} disabled={enviando} className="px-3 py-1.5 text-xs font-bold text-white rounded-lg bg-emerald-600 active:bg-emerald-700 disabled:opacity-50">{enviando ? 'Enviando…' : 'Sí, enviar'}</button>
            </div>
          </div>
        )}
      </div>

      {confirmSalary && (
        <ConfirmDoble
          titulo={`Habilitar proyección salarial para ${user.nombre || '(sin nombre)'}`}
          detalle={'Este usuario verá la pestaña "Proyección" con la estimación salarial (cálculo del convenio). Confirmá que corresponde a esta persona antes de habilitarlo.'}
          etiquetaConfirmar="Habilitar"
          enviando={salaryBusy}
          onCancel={() => setConfirmSalary(false)}
          onConfirm={() => void aplicarSalary(true)}
        />
      )}
    </div>
  )
}

/** Botón de pestaña del header de admin. `badge` muestra un contador (ej. sugerencias nuevas). */
/** Diagnóstico + acciones de la sesión admin. Compara el UID autenticado contra el de las reglas
 *  (ADMIN_UID_ESPERADO): si NO coincide, ninguna escritura admin funciona. Permite refrescar el token
 *  (arregla token viejo) o cerrar sesión (para reloguear). */
function SesionAdminCard({ onLogout }: { onLogout: () => void }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined) // undefined = cargando
  const [copiado, setCopiado] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  useEffect(() => {
    let vivo = true
    adminUidActual().then(u => { if (vivo) setUid(u) })
    return () => { vivo = false }
  }, [])

  const coincide = uid === ADMIN_UID_ESPERADO

  async function copiar() {
    if (!uid) return
    try { await navigator.clipboard.writeText(uid); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* ignore */ }
  }

  async function refrescar() {
    setRefrescando(true); setMsg(null)
    const ok = await refrescarTokenAdmin()
    setMsg(ok
      ? { ok: true, texto: 'Token renovado ✓ — probá la acción de nuevo.' }
      : { ok: false, texto: 'No se pudo: no hay sesión activa. Cerrá sesión y reingresá.' })
    setUid(await adminUidActual())
    setRefrescando(false)
  }

  async function salir() {
    await logoutAdmin()
    // Al salir de admin, asegurar que el código de respaldo 000000 no quedó vacío (si no, quedaría
    // sin poder re-desbloquear la pantalla admin). Best-effort, no bloquea la navegación.
    await asegurarCodigoAdmin()
    onLogout()
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4 space-y-3">
      <span className="text-sm font-semibold text-white flex items-center gap-1.5"><KeyRound size={15} /> Sesión admin</span>

      {uid === undefined ? (
        <p className="text-xs text-slate-400">Verificando sesión…</p>
      ) : (
        <>
          {/* Estado según el UID */}
          {uid === null ? (
            <div className="flex items-start gap-2 rounded-xl bg-amber-950/40 border border-amber-800/40 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>No hay sesión de Firebase activa. Cerrá sesión y volvé a entrar para reautenticarte.</span>
            </div>
          ) : coincide ? (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 text-[12px] text-emerald-200">
              <Check size={15} className="shrink-0 mt-0.5" />
              <span>Coincide con el UID de las reglas: sos admin. Si igual una acción falla, tocá «Refrescar token».</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-red-950/40 border border-red-800/40 px-3 py-2 text-[12px] text-red-200">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>Tu UID <b>no coincide</b> con el de las reglas: por eso fallan las escrituras admin. Poné este UID en <code className="font-mono">firestore.rules</code> (o volvé a la cuenta correcta).</span>
            </div>
          )}

          {/* UID actual (copiable) */}
          {uid !== null && (
            <div className="space-y-1">
              <span className="text-[11px] text-slate-400">UID actual (tocá para copiar)</span>
              <button onClick={copiar} className="w-full flex items-center gap-2 rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-left active:bg-slate-900">
                <code className="flex-1 text-[12px] text-slate-200 break-all font-mono">{uid}</code>
                {copiado ? <Check size={15} className="shrink-0 text-emerald-400" /> : <Copy size={15} className="shrink-0 text-slate-400" />}
              </button>
            </div>
          )}

          {/* UID esperado (referencia) */}
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400">UID esperado (reglas)</span>
            <code className="block rounded-lg bg-slate-900/40 border border-slate-800 px-3 py-2 text-[12px] text-slate-400 break-all font-mono">{ADMIN_UID_ESPERADO}</code>
          </div>

          {msg && <p className={`text-[12px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.texto}</p>}

          {/* Acciones */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={refrescar} disabled={refrescando} className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-700 text-slate-100 text-xs font-medium px-3 py-2 active:bg-slate-600 disabled:opacity-50">
              <RefreshCw size={14} className={refrescando ? 'animate-spin' : ''} /> {refrescando ? 'Refrescando…' : 'Refrescar token'}
            </button>
            <button onClick={salir} className="flex items-center justify-center gap-1.5 rounded-lg bg-red-900/60 text-red-100 text-xs font-medium px-3 py-2 active:bg-red-900">
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function TabBtn({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: React.ReactNode; badge?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${active ? 'bg-slate-700 text-white' : 'text-slate-400 active:bg-slate-800'}`}
    >
      {icon} {label}
      {badge ? <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-900 tabular-nums">{badge}</span> : null}
    </button>
  )
}

const SUG_SIN_VERSION = '(?)'
const verDeSug = (s: SugerenciaEntry) => s.version || SUG_SIN_VERSION

/** Panel de sugerencias recibidas: historial completo (Firestore es inmutable) + filtros. */
function SugerenciasPanel({ sugerencias, cargando, sugVistas }: { sugerencias: SugerenciaEntry[]; cargando: boolean; sugVistas: number }) {
  const [q, setQ] = useState('')
  const [verSel, setVerSel] = useState<Set<string>>(new Set())
  const [soloNuevas, setSoloNuevas] = useState(false)
  // Snapshot de "vistas" al abrir la pestaña: las que eran nuevas siguen marcadas mientras estás acá
  // (el padre actualiza sugVistas al entrar para limpiar el badge; este snapshot conserva el estado).
  const [vistasSnapshot] = useState(() => sugVistas)

  const versiones = useMemo(() => [...new Set(sugerencias.map(verDeSug))].sort().reverse(), [sugerencias])
  const nuevasCount = useMemo(() => sugerencias.filter(s => s.createdAt > vistasSnapshot).length, [sugerencias, vistasSnapshot])
  const filtradas = useMemo(() => {
    const qn = q.trim().toLowerCase()
    return sugerencias.filter(s => {
      if (qn && !(s.nombre.toLowerCase().includes(qn) || s.texto.toLowerCase().includes(qn))) return false
      if (verSel.size && !verSel.has(verDeSug(s))) return false
      if (soloNuevas && !(s.createdAt > vistasSnapshot)) return false
      return true
    })
  }, [sugerencias, q, verSel, soloNuevas, vistasSnapshot])

  const hayFiltro = !!q.trim() || verSel.size > 0 || soloNuevas
  function limpiar() { setQ(''); setVerSel(new Set()); setSoloNuevas(false) }

  if (cargando) return <p className="text-sm text-slate-500 py-10 text-center">Cargando…</p>
  if (sugerencias.length === 0) {
    return (
      <div className="py-12 text-center">
        <Lightbulb size={28} className="mx-auto text-slate-600 mb-2" />
        <p className="text-sm text-slate-500">Todavía no recibiste sugerencias.</p>
        <p className="text-[11px] text-slate-600 mt-1">Aparecen acá cuando un usuario envía una desde Configuración.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filtros</span>
          {hayFiltro && (
            <button onClick={limpiar} className="text-[11px] text-blue-300 active:text-blue-200 flex items-center gap-1">
              <X size={12} /> Limpiar
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar por nombre o texto…"
            className="w-full bg-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/70"
          />
        </div>
        {versiones.length > 1 && (
          <ChipRow titulo="Versión" valores={versiones} sel={verSel} onToggle={v => setVerSel(toggle(verSel, v))} />
        )}
        <button
          onClick={() => setSoloNuevas(v => !v)}
          disabled={nuevasCount === 0}
          className={`text-[11px] font-medium px-2.5 py-1 rounded-lg disabled:opacity-40 ${soloNuevas ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-400'}`}
        >
          Solo nuevas{nuevasCount > 0 ? ` (${nuevasCount})` : ''}
        </button>
      </div>

      {/* Historial */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1.5">
          <History size={12} /> Historial {hayFiltro ? <span className="text-slate-400">({filtradas.length} de {sugerencias.length})</span> : <span className="text-slate-400">({sugerencias.length})</span>}
        </p>
        {filtradas.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">Ninguna sugerencia coincide con el filtro.</p>
        ) : (
          <div className="space-y-2">
            {filtradas.map(s => <SugerenciaCard key={s.id} s={s} nueva={s.createdAt > vistasSnapshot} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function SugerenciaCard({ s, nueva }: { s: SugerenciaEntry; nueva: boolean }) {
  const [copiado, setCopiado] = useState(false)
  const vieja = s.version && s.version !== APP_VERSION
  async function copiar() {
    try { await navigator.clipboard.writeText(s.texto); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* ignore */ }
  }
  return (
    <div className={`rounded-xl border bg-slate-800/50 p-3 ${nueva ? 'border-amber-500/40' : 'border-slate-700'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200 truncate flex items-center gap-1.5">
            {nueva && <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-900">Nueva</span>}
            <span className="truncate">{s.nombre || '(sin nombre)'}</span>
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            {s.linea && `${s.linea} · `}<span className={vieja ? 'text-amber-400' : 'text-slate-500'}>v{s.version || '?'}</span> · {fmtFecha(s.createdAt)}
          </p>
        </div>
        <button onClick={copiar} className="shrink-0 text-slate-400 active:text-emerald-300" title="Copiar texto">
          {copiado ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-200 whitespace-pre-wrap break-words leading-snug">{s.texto}</p>
    </div>
  )
}

function Stat({ icon, valor, label, sub, color }: { icon: React.ReactNode; valor: number; label: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-slate-500">{icon}<span className="text-[10px] uppercase tracking-wide">{label}</span></div>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  )
}

function UsoBar({ label, usado, tope }: { label: string; usado: number; tope: number }) {
  const pct = Math.min(100, Math.round((usado / tope) * 100))
  const quedan = Math.max(0, tope - usado)
  const color = pct >= 90 ? '#fb7185' : pct >= 70 ? '#fbbf24' : '#38bdf8'
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400 tabular-nums">quedan {quedan.toLocaleString('es-AR')} de {tope.toLocaleString('es-AR')}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

/** Tarjeta de netos estimados por usuario (privado, sólo-admin). Lista ordenada desc + total. */
function NetosCard({ netos, total }: { netos: NetoEntry[]; total: number }) {
  return (
    <div className="rounded-2xl border border-teal-700/40 bg-teal-950/20 p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-semibold text-white flex items-center gap-1.5"><Banknote size={15} className="text-teal-300" /> Netos estimados</p>
        <span className="text-[11px] text-slate-400">{netos.length} {netos.length === 1 ? 'usuario' : 'usuarios'}</span>
      </div>
      <div className="space-y-1">
        {netos.map(n => (
          <div key={n.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/50 px-3 py-1.5">
            <span className="text-sm text-slate-200 truncate">{n.nombre || '(sin nombre)'}</span>
            <span className="shrink-0 text-right">
              <span className="text-sm font-bold text-teal-300 tabular-nums">{fmtPesos(n.neto)}</span>
              {n.proyectado > 0 && n.proyectado !== n.neto && (
                <span className="block text-[10px] text-slate-500 tabular-nums">proy. {fmtPesos(n.proyectado)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-teal-700/30 pt-2">
        <span className="text-xs font-medium text-slate-300">Total</span>
        <span className="text-sm font-bold text-teal-200 tabular-nums">{fmtPesos(total)}</span>
      </div>
      <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
        Neto del período actual con lo cargado hasta ahora (proy. = estimado a fin de período). Sólo
        aparecen los usuarios que cargaron su sueldo básico. Privado: nadie más que vos lo ve.
      </p>
    </div>
  )
}

function Grafico({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-3">
      <p className="text-xs font-semibold text-slate-300 mb-2.5">{titulo}</p>
      {children}
    </div>
  )
}

function Barras({ datos, color }: { datos: [string, number][]; color: string }) {
  const max = Math.max(1, ...datos.map(d => d[1]))
  return (
    <div className="space-y-1.5">
      {datos.map(([k, n]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-xs text-slate-300" title={k}>{k}</span>
          <div className="flex-1 h-4 rounded bg-slate-700/40 overflow-hidden">
            <div className="h-full rounded transition-[width] duration-700" style={{ width: `${(n / max) * 100}%`, background: color }} />
          </div>
          <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-200">{n}</span>
        </div>
      ))}
    </div>
  )
}

function ChipRow({ titulo, valores, sel, onToggle }: { titulo: string; valores: string[]; sel: Set<string>; onToggle: (v: string) => void }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {valores.map(v => (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className={`text-[11px] px-2.5 py-1 rounded-lg ${sel.has(v) ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

function toggle(set: Set<string>, v: string): Set<string> {
  const next = new Set(set)
  if (next.has(v)) next.delete(v); else next.add(v)
  return next
}

/** Fecha+hora corta (es-AR) para el historial de difusiones. */
function fmtFecha(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Panel de acciones globales: encender/apagar el donador para todos + difundir un mensaje + historial. */
function AdminAcciones({ config, difusiones, titulo, setTitulo, cuerpo, setCuerpo, onToggleBeggar, onEnviar, onLimpiar }: {
  config: AppConfig | null
  difusiones: DifusionEntry[]
  titulo: string; setTitulo: (v: string) => void
  cuerpo: string; setCuerpo: (v: string) => void
  onToggleBeggar: () => void
  onEnviar: () => void
  onLimpiar: () => void
}) {
  const puedeEnviar = titulo.trim().length > 0 || cuerpo.trim().length > 0
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Acciones globales</p>

      {/* Donador on/off para todos */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white flex items-center gap-1.5"><Power size={14} /> Donador para todos</p>
          <p className="text-[11px] text-slate-500">
            {config == null ? 'Cargando…' : config.beggarActivo ? 'Activo: aparece al exportar.' : 'Desactivado para todos.'}
          </p>
        </div>
        <button
          onClick={onToggleBeggar}
          disabled={config == null}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${config?.beggarActivo ? 'bg-emerald-500' : 'bg-slate-600'}`}
          aria-label="Activar o desactivar el donador para todos"
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${config?.beggarActivo ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {/* Difusión: mensaje a todos */}
      <div className="border-t border-slate-700/70 pt-3 space-y-2">
        <p className="text-sm font-medium text-white flex items-center gap-1.5"><Megaphone size={14} /> Mensaje a todos</p>
        <input
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
          maxLength={60}
          placeholder="Título (ej. NUEVA FUNCIÓN)"
          className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <textarea
          value={cuerpo}
          onChange={e => setCuerpo(e.target.value)}
          maxLength={400}
          rows={3}
          placeholder="Mensaje… (se muestra una sola vez a cada usuario)"
          className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500 tabular-nums">{cuerpo.length}/400</span>
          <button
            onClick={onEnviar}
            disabled={!puedeEnviar}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white active:bg-emerald-700 disabled:opacity-40"
          >
            <Send size={13} /> Enviar a todos
          </button>
        </div>

        {/* Difusión activa actualmente: qué mensaje está "vivo" + botón para limpiarlo (que no quede
            mostrándose a quien no lo vio; p.ej. una prueba antes de abrir a todos). */}
        {config?.difusionId ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-600/60 bg-slate-700/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Difusión activa</p>
              <p className="text-xs text-slate-200 truncate">{config.difusionTitulo || '(sin título)'}</p>
            </div>
            <button
              onClick={onLimpiar}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-600 px-2.5 py-1 text-[11px] font-medium text-slate-200 active:bg-slate-500"
            >
              <Eraser size={12} /> Limpiar
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">No hay ninguna difusión activa.</p>
        )}
      </div>

      {/* Historial de mensajes enviados */}
      {difusiones.length > 0 && (
        <div className="border-t border-slate-700/70 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1"><History size={12} /> Historial ({difusiones.length})</p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {difusiones.map(d => (
              <div key={d.id} className="rounded-lg bg-slate-700/40 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-emerald-300 truncate">{d.titulo || '(sin título)'}</p>
                  <span className="text-[10px] text-slate-500 shrink-0">{fmtFecha(d.createdAt)}</span>
                </div>
                {d.cuerpo && <p className="text-[11px] text-slate-300 mt-0.5 whitespace-pre-wrap break-words line-clamp-3">{d.cuerpo}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Modal de confirmación para acciones que afectan a todos los usuarios. `pasos`=2 (default) pide
 *  una reconfirmación ("¿Estás seguro?"); `pasos`=1 confirma de una (para acciones de bajo riesgo). */
function ConfirmDoble({ titulo, detalle, etiquetaConfirmar, peligro, enviando, pasos = 2, onCancel, onConfirm }: {
  titulo: string
  detalle: string
  etiquetaConfirmar: string
  peligro?: boolean
  enviando: boolean
  pasos?: 1 | 2
  onCancel: () => void
  onConfirm: () => void
}) {
  const [paso, setPaso] = useState(1)
  const final = paso >= pasos
  const reconfirm = pasos === 2 && paso === 2
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60" onClick={enviando ? undefined : onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className={reconfirm ? 'text-rose-300' : 'text-amber-300'} />
          <p className="text-sm font-bold text-white">{reconfirm ? '¿Estás seguro?' : titulo}</p>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
          {reconfirm ? 'Esta acción afecta a TODOS los usuarios. Tocá confirmar para continuar.' : detalle}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={enviando}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 rounded-lg bg-slate-700 active:bg-slate-600 disabled:opacity-50"
          >
            Cancelar
          </button>
          {final ? (
            <button
              onClick={onConfirm}
              disabled={enviando}
              className={`px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-50 ${peligro ? 'bg-rose-600 active:bg-rose-700' : 'bg-emerald-600 active:bg-emerald-700'}`}
            >
              {enviando ? 'Aplicando…' : etiquetaConfirmar}
            </button>
          ) : (
            <button onClick={() => setPaso(p => p + 1)} className="px-3 py-1.5 text-xs font-bold text-white rounded-lg bg-amber-600 active:bg-amber-700">
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
