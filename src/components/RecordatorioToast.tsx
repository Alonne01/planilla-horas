import { useState } from 'react'
import { CalendarClock, Bell, BellRing, X } from 'lucide-react'
import { textoCierre, activarRecordatorios, notificacionesConcedidas, notificacionesSoportadas } from '../lib/recordatorio'

/**
 * Aviso EN-APP de fin de período (se muestra al abrir, dentro de la ventana del recordatorio).
 * Ofrece activar las notificaciones (para que también lleguen con la app cerrada en Android).
 */
export function RecordatorioToast({ cierreMs, onClose }: { cierreMs: number; onClose: () => void }) {
  const { dia, mes } = textoCierre(cierreMs)
  const [activadas, setActivadas] = useState(notificacionesConcedidas())
  const [busy, setBusy] = useState(false)

  async function activar() {
    setBusy(true)
    const ok = await activarRecordatorios()
    setActivadas(ok)
    setBusy(false)
  }

  return (
    <div className="fixed inset-x-3 bottom-20 z-[80] mx-auto max-w-sm rounded-2xl border border-amber-500/40 bg-slate-800 p-4 shadow-2xl shadow-black/50 animate-[gate-rise_240ms_ease_both]">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-amber-500/15 shrink-0">
          <CalendarClock size={18} className="text-amber-300" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight">Cierre de la planilla</p>
          <p className="mt-1 text-sm text-slate-300 leading-snug">
            El período cierra el <span className="font-semibold text-amber-200">{dia} de {mes}</span>. Acordate de
            cargar y <span className="font-semibold text-slate-100">enviar</span> tu planilla.
          </p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 -mt-1 -mr-1"><X size={18} /></button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {notificacionesSoportadas() && !activadas ? (
          <button
            onClick={activar}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold active:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Bell size={15} /> {busy ? 'Activando…' : 'Avisarme el mes que viene'}
          </button>
        ) : activadas ? (
          <span className="flex-1 py-2.5 text-center text-xs font-medium text-emerald-300 flex items-center justify-center gap-1.5">
            <BellRing size={14} /> Avisos activados
          </span>
        ) : null}
        <button
          onClick={onClose}
          className={`${notificacionesSoportadas() && !activadas ? '' : 'flex-1'} px-4 py-2.5 rounded-xl bg-slate-700 text-slate-200 text-sm font-medium active:bg-slate-600`}
        >
          Entendido
        </button>
      </div>
    </div>
  )
}
