import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Users, Heart, Sparkles, Search, X, Cloud, Activity, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { listarPadronNube, leerUsoFirebase, type PadronEntry, type UsoFirebase } from '../lib/cloud-backup'
import { APP_VERSION } from '../version'

const ACTIVO_MS = 7 * 24 * 60 * 60 * 1000 // "activo" = respaldó en los últimos 7 días
const SIN_LINEA = '(sin línea)'
const SIN_VERSION = '(?)'

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

export function AdminPage() {
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
  }
  useEffect(() => { void cargar() }, [])

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
  const activos = useMemo(() => filtrado.filter(e => Date.now() - e.updatedAt <= ACTIVO_MS).length, [filtrado])
  const desactualizados = useMemo(() => filtrado.filter(e => e.version && e.version !== APP_VERSION).length, [filtrado])
  const porLinea = useMemo(() => agrupar(filtrado, lineaDe), [filtrado])
  const porVersion = useMemo(() => agrupar(filtrado, versionDe), [filtrado])

  const hayFiltro = !!q.trim() || lineasSel.size > 0 || versionesSel.size > 0 || soloActivos
  function limpiar() { setQ(''); setLineasSel(new Set()); setVersionesSel(new Set()); setSoloActivos(false) }

  return (
    <div className="min-h-screen bg-slate-900 pb-12">
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Admin</h1>
        <button
          onClick={cargar}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg px-3 py-1.5 active:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {err && (
          <div className="p-3 rounded-xl bg-red-900/40 text-red-300 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{err}</span>
          </div>
        )}

        {/* Medidor de uso GLOBAL de Firebase (todos los usuarios) vs cuota del plan gratis */}
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

        {/* Tarjetas de métricas (reflejan el filtro) */}
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={<Users size={15} />} valor={filtrado.length} label={filtrado.length === 1 ? 'usuario' : 'usuarios'} sub={`${activos} activos (7 d)`} color="text-white" />
          <Stat icon={<Activity size={15} />} valor={desactualizados} label="desactualizados" sub={`última: v${APP_VERSION}`} color="text-amber-300" />
          <Stat icon={<FileSpreadsheet size={15} />} valor={totalExp} label="exportaciones" color="text-emerald-300" />
          <Stat icon={<Heart size={15} />} valor={totalDon} label="toques a donar" color="text-pink-300" />
          <Stat icon={<Sparkles size={15} />} valor={totalGra} label='veces "gracias"' color="text-amber-300" />
        </div>

        {/* Filtros dinámicos */}
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

        {/* Gráficos de uso */}
        {filtrado.length > 0 && (
          <>
            <Grafico titulo="Usuarios por línea"><Barras datos={porLinea} color="#38bdf8" /></Grafico>
            <Grafico titulo="Usuarios por versión"><Barras datos={porVersion} color="#a78bfa" /></Grafico>
          </>
        )}

        {/* Lista */}
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
                      {(e.exportaciones ?? 0) > 0 && <span className="flex items-center gap-0.5 text-emerald-300"><FileSpreadsheet size={11} /> {e.exportaciones}</span>}
                      {(e.donaciones ?? 0) > 0 && <span className="flex items-center gap-0.5 text-pink-300"><Heart size={11} /> {e.donaciones}</span>}
                      {(e.gracias ?? 0) > 0 && <span className="flex items-center gap-0.5 text-amber-300"><Sparkles size={11} /> {e.gracias}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
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
