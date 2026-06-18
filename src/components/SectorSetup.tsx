import { useEffect, useState } from 'react'
import { Briefcase, Check, Loader2 } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { LINEAS_TRABAJO, type LineaTrabajo } from '../lib/calculo-horas'
import { marcarSectorConfirmado } from '../onboarding/tutorial'

/**
 * Prompt OBLIGATORIO del sector (línea de trabajo), análogo a [DiagramaSetup]. Se muestra en el
 * primer inicio (después del setup, junto al del diagrama). El sector define cómo se cuentan las
 * horas (p. ej. SBDP) y viaja en el respaldo/planilla. Después se puede cambiar en Configuración.
 */
export function SectorSetup({ onDone }: { onDone: () => void }) {
  const { settings, update, loaded } = useSettings()
  const [key, setKey] = useState<LineaTrabajo>('SURFACE_WELL_TESTING')
  const [init, setInit] = useState(false)
  const [busy, setBusy] = useState(false)

  // Precargar con lo que ya tenga (default para uno nuevo).
  useEffect(() => {
    if (loaded && !init) {
      setKey(settings.lineaTrabajo)
      setInit(true)
    }
  }, [loaded, init, settings])

  async function confirmar() {
    if (busy) return
    setBusy(true)
    try {
      await update({ lineaTrabajo: key })
      marcarSectorConfirmado()
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900 p-5">
      <div className="w-full max-w-md animate-[gate-rise_280ms_ease_both]">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-blue-600/20">
            <Briefcase size={28} className="text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-white">¿En qué sector trabajás?</h1>
          <p className="mt-2 text-sm leading-snug text-slate-400">
            Define cómo se cuentan tus horas. Podés cambiarlo después en Configuración.
          </p>
        </div>

        <div className="space-y-2">
          {LINEAS_TRABAJO.map(l => (
            <button
              key={l.key}
              onClick={() => setKey(l.key)}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${key === l.key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}
            >
              <div className="text-sm font-bold">{l.label}</div>
              <div className={`mt-0.5 text-xs ${key === l.key ? 'text-blue-100/80' : 'text-slate-400'}`}>{l.desc}</div>
            </button>
          ))}
        </div>

        <button
          onClick={confirmar}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Confirmar
        </button>
      </div>
    </div>
  )
}
