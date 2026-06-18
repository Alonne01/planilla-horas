import { useState } from 'react'
import { Lightbulb, Send, X, Check, Clock, ShieldCheck } from 'lucide-react'
import { enviarSugerencia, puedeEnviarSugerenciaHoy } from '../lib/cloud-backup'

/**
 * Modal para enviar una sugerencia al admin. De cara al usuario es ANÓNIMA (sólo se le informa que
 * registra la versión de la app), para que se anime a usarla; internamente igual viaja el nombre del
 * padrón. Tope: 1 envío por día por dispositivo. Muestra una animación de "envío" antes del éxito.
 */
export function SugerenciaModal({ nombre, linea, onClose }: { nombre: string; linea?: string; onClose: () => void }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Se evalúa una vez al abrir: si ya mandó hoy, mostramos el aviso en vez del formulario.
  const [puedeHoy] = useState(() => puedeEnviarSugerenciaHoy())

  const MAX = 600
  const puede = texto.trim().length >= 3 && !enviando

  async function enviar() {
    if (!puede) return
    setEnviando(true); setErr(null)
    // Mínimo ~1 s para que la animación de envío se aprecie aunque la subida sea instantánea.
    const minDelay = new Promise(r => setTimeout(r, 1000))
    try {
      await Promise.all([enviarSugerencia(nombre, texto, linea), minDelay])
      setEnviado(true)
    } catch {
      setErr('No se pudo enviar. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[backdrop-fade-in_150ms_ease_both]" onClick={enviando ? undefined : onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-3 shadow-2xl animate-[apply-bar-in_220ms_ease_both]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-bold text-white flex items-center gap-2 min-w-0">
            <Lightbulb size={17} className="text-amber-300 shrink-0" /> <span className="truncate">Enviar sugerencia</span>
          </p>
          {!enviando && (
            <button onClick={onClose} className="shrink-0 text-slate-400 active:text-slate-200" aria-label="Cerrar"><X size={17} /></button>
          )}
        </div>

        {enviado ? (
          // Éxito
          <div className="py-4 text-center space-y-2">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400 animate-[lock-pop_420ms_cubic-bezier(.34,1.56,.64,1)]">
              <Check size={26} />
            </div>
            <p className="text-sm font-semibold text-white">¡Gracias por tu sugerencia!</p>
            <p className="text-xs text-slate-400">La voy a leer. Podés enviar otra mañana.</p>
            <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl bg-slate-700 text-white text-sm font-medium active:scale-95 transition-transform">
              Cerrar
            </button>
          </div>
        ) : enviando ? (
          // Animación de envío: el avión "despega" en loop mientras sube.
          <div className="py-8 flex flex-col items-center gap-3">
            <div className="relative grid h-16 w-16 place-items-center overflow-hidden">
              <span className="absolute inset-0 rounded-full bg-amber-500/10 animate-ping" />
              <Send size={30} className="text-amber-300 animate-[send-fly_900ms_ease-in_infinite]" />
            </div>
            <p className="text-sm font-semibold text-white">Enviando tu sugerencia…</p>
          </div>
        ) : !puedeHoy ? (
          // Ya envió hoy (tope diario)
          <div className="py-4 text-center space-y-2">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-500/15 text-amber-400">
              <Clock size={24} />
            </div>
            <p className="text-sm font-semibold text-white">Ya enviaste una sugerencia hoy</p>
            <p className="text-xs text-slate-400">Para evitar el spam, se puede enviar una por día. ¡Probá mañana!</p>
            <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl bg-slate-700 text-white text-sm font-medium active:scale-95 transition-transform">
              Entendido
            </button>
          </div>
        ) : (
          // Formulario
          <>
            <p className="text-xs text-slate-400 leading-snug">
              Contame qué mejorarías o qué te gustaría que tenga la app.
            </p>
            {/* Aviso de anonimato (incentiva a usarla; sólo se menciona la versión) */}
            <div className="flex items-center gap-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 px-3 py-2">
              <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
              <span className="text-[11px] text-emerald-200/90 leading-snug">Es <b>anónima</b>. Solo se registra la versión de la app que usás.</span>
            </div>
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              maxLength={MAX}
              rows={4}
              autoFocus
              placeholder="Tu sugerencia… (ej. me gustaría poder exportar en PDF)"
              className="w-full bg-slate-700 text-white rounded-xl px-3 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/70 resize-none"
            />
            {err && <p className="text-xs text-red-400">{err}</p>}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500 tabular-nums">{texto.length}/{MAX} · 1 por día</span>
              <button
                onClick={enviar}
                disabled={!puede}
                className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white active:bg-amber-700 active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
              >
                <Send size={14} /> Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
