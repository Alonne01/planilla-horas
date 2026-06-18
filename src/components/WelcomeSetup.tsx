import { useState } from 'react'
import { Cloud, KeyRound, Loader2, AlertTriangle, Check } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { configurarNubeAuto } from '../lib/cloud-backup'
import { lineaLabel } from '../lib/calculo-horas'

/**
 * Setup OBLIGATORIO del primer inicio (reemplaza al tour spotlight). Pide lo único imprescindible:
 * nombre y apellido. Con eso genera el código de respaldo y sube el primer backup a la nube,
 * automáticamente. Bloquea la pantalla hasta completarlo. El resto (línea, diagrama, feriados) se
 * configura después en Configuración, y el tutorial se muestra como un carrusel simple aparte.
 */
export function WelcomeSetup({ onDone }: { onDone: () => void }) {
  const { settings, update } = useSettings()
  const [nombre, setNombre] = useState('')
  const [fase, setFase] = useState<'nombre' | 'codigo'>('nombre')
  const [busy, setBusy] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [subido, setSubido] = useState(false)

  // Válido = nombre + espacio + apellido de al menos 2 caracteres.
  const v = nombre.trim()
  const sp = v.indexOf(' ')
  const nombreValido = sp > 0 && v.slice(sp + 1).trim().length >= 2

  async function crear() {
    if (!nombreValido || busy) return
    setBusy(true)
    try {
      // Guardar el nombre ANTES de respaldar, para que el backup lleve el nombre real.
      await update({ nombreUsuario: v })
      try {
        const r = await configurarNubeAuto(v, lineaLabel(settings.lineaTrabajo))
        setCodigo(r.codigo)
        setSubido(r.subido)
      } catch {
        // Sin conexión / error: generamos un código local y seguimos; el respaldo reintenta al abrir.
        const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
        await update({ backupCodigo: code, backupBloqueado: true })
        setCodigo(code)
        setSubido(false)
      }
      setFase('codigo')
    } finally {
      setBusy(false)
    }
  }

  const primerNombre = v.split(/\s+/)[0] || ''

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900 p-5">
      <div className="w-full max-w-md animate-[gate-rise_280ms_ease_both]">
        {fase === 'nombre' ? (
          <>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-blue-600/20">
                <Cloud size={28} className="text-blue-400" />
              </div>
              <h1 className="text-xl font-bold text-white">Bienvenido a Planilla de Horas</h1>
              <p className="mt-2 text-sm leading-snug text-slate-400">
                Para empezar solo necesitamos tu <strong className="text-slate-200">nombre y apellido</strong>.
                Con eso creamos tu <strong className="text-slate-200">respaldo en la nube</strong> automáticamente,
                así no perdés tus datos si cambiás de celular.
              </p>
            </div>

            <label className="mb-1.5 block text-xs font-medium text-slate-400">Nombre y apellido</label>
            <input
              type="text"
              value={nombre}
              autoFocus
              onChange={e => setNombre(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nombreValido) void crear() }}
              placeholder="Ej: Juan Topo"
              className="w-full rounded-xl bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              Se usa en la planilla, en el Excel que exportás y en el respaldo. Después podés cambiarlo en Configuración.
            </p>

            <button
              onClick={crear}
              disabled={!nombreValido || busy}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <><Loader2 size={16} className="animate-spin" /> Creando tu respaldo…</> : 'Continuar'}
            </button>
          </>
        ) : (
          <>
            <div className="mb-5 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600/20">
                <Check size={28} className="text-emerald-400" />
              </div>
              <h1 className="text-xl font-bold text-white">¡Listo{primerNombre ? `, ${primerNombre}` : ''}!</h1>
              <p className="mt-2 text-sm leading-snug text-slate-400">
                Tu respaldo en la nube quedó configurado. Esta es tu <strong className="text-slate-200">llave de recuperación</strong>:
              </p>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <KeyRound size={14} /> Tu código de respaldo
              </div>
              <div className="mt-2 text-center font-mono text-3xl font-bold tracking-[0.4em] text-white">{codigo}</div>
            </div>

            <div className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300/80" />
              <p className="text-[11px] leading-snug text-amber-200/90">
                Anotá tu <strong className="text-amber-100">nombre + este código</strong>: juntos son la llave para
                recuperar tu planilla en otro dispositivo. El código se genera una sola vez y no se puede cambiar.
              </p>
            </div>

            {!subido && (
              <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] leading-snug text-slate-400">
                <Cloud size={13} className="mt-0.5 shrink-0" />
                Tu respaldo se subirá apenas tengas conexión.
              </p>
            )}

            <button
              onClick={onDone}
              className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors active:bg-blue-700"
            >
              Empezar a usar la app
            </button>
          </>
        )}
      </div>
    </div>
  )
}
