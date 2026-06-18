import { useEffect, useState, type ReactNode } from 'react'
import { CalendarRange, Check, Loader2 } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { DIAGRAMAS, type DiagramaPatternKey } from '../lib/diagrama'
import { marcarDiagramaConfirmado } from '../onboarding/tutorial'

function localDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseDateLocal(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
function fmtDia(d: Date): string {
  const s = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Prompt OBLIGATORIO del diagrama (tipo + fecha de inicio) con VISTA PREVIA antes de confirmar.
 * Es crucial para distinguir qué días son de trabajo y cuáles de franco. Se muestra después de
 * generar el código (1er inicio) o al abrir la app si nunca se eligió el diagrama.
 */
export function DiagramaSetup({ onDone }: { onDone: () => void }) {
  const { settings, update, loaded } = useSettings()
  const [key, setKey] = useState<DiagramaPatternKey>('LUNES_VIERNES')
  const [fecha, setFecha] = useState('')
  const [init, setInit] = useState(false)
  const [busy, setBusy] = useState(false)

  // Precargar con lo que ya tenga (usuario existente que nunca confirmó); para uno nuevo son los defaults.
  useEffect(() => {
    if (loaded && !init) {
      setKey(settings.diagrama)
      setFecha(settings.diagramaInicioMs ? localDateStr(settings.diagramaInicioMs) : '')
      setInit(true)
    }
  }, [loaded, init, settings])

  const pat = DIAGRAMAS.find(d => d.key === key)!
  const esRotativo = key !== 'LUNES_VIERNES'
  const fechaMs = fecha ? parseDateLocal(fecha) : 0
  const puedeConfirmar = !esRotativo || fechaMs > 0

  let preview: ReactNode = null
  if (!esRotativo) {
    preview = <>Trabajás de <strong className="text-white">lunes a viernes</strong> y tenés franco <strong className="text-white">sábado y domingo</strong>.</>
  } else if (fechaMs > 0) {
    const ingreso = new Date(fechaMs)
    const francoStart = new Date(fechaMs); francoStart.setDate(francoStart.getDate() + pat.diasTrabajo)
    preview = (
      <>Con el diagrama <strong className="text-white">{pat.label}</strong>, ingresás al diagrama el{' '}
        <strong className="text-white">{fmtDia(ingreso)}</strong> y salís de franco el{' '}
        <strong className="text-white">{fmtDia(francoStart)}</strong>. ¿Está correcto?</>
    )
  }

  async function confirmar() {
    if (!puedeConfirmar || busy) return
    setBusy(true)
    try {
      await update({ diagrama: key, diagramaInicioMs: esRotativo ? fechaMs : 0 })
      marcarDiagramaConfirmado()
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
            <CalendarRange size={28} className="text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Configurá tu diagrama</h1>
          <p className="mt-2 text-sm leading-snug text-slate-400">
            Es clave para saber qué días son de <strong className="text-slate-200">trabajo</strong> y
            cuáles de <strong className="text-slate-200">franco</strong>. Elegí tu diagrama y, si rota,
            el día que subís al campo.
          </p>
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-400">Tipo de diagrama</label>
        <div className="grid grid-cols-2 gap-2">
          {DIAGRAMAS.map(d => (
            <button
              key={d.key}
              onClick={() => setKey(d.key)}
              className={`rounded-xl px-3 py-2.5 text-left transition-colors ${key === d.key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}
            >
              <div className="text-sm font-bold">{d.label}</div>
              <div className={`mt-0.5 text-xs ${key === d.key ? 'text-blue-100/80' : 'text-slate-400'}`}>
                {d.diasTrabajo} trabajo · {d.diasFranco} franco
              </div>
            </button>
          ))}
        </div>

        {esRotativo && (
          <div className="mt-3">
            <label className="mb-1.5 block text-xs font-medium text-slate-400">¿Qué día subís al campo? (inicio del diagrama)</label>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="w-full rounded-xl bg-slate-800 px-3 py-2.5 text-sm text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Vista previa */}
        {preview ? (
          <div className="mt-4 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
            <p className="text-sm leading-snug text-blue-100">{preview}</p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
            <p className="text-sm leading-snug text-slate-400">Elegí el día de inicio para ver la vista previa.</p>
          </div>
        )}

        <button
          onClick={confirmar}
          disabled={!puedeConfirmar || busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Sí, es correcto
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-500">Después podés cambiarlo en Configuración.</p>
      </div>
    </div>
  )
}
