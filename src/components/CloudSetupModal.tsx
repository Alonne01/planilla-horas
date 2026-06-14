import { Cloud } from 'lucide-react'

/**
 * Modal de una vez para usuarios que ya tienen nombre pero NO configuraron el respaldo en la
 * nube (aparece tras el deploy). "Configurar ahora" lleva a Config + mini-tour; "Más tarde"
 * lo pospone (el caller maneja el snooze).
 */
export function CloudSetupModal({ onConfigurar, onMasTarde }: { onConfigurar: () => void; onMasTarde: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 animate-[backdrop-fade-in_200ms_ease_both]">
      <div className="w-full max-w-sm rounded-2xl border border-sky-500/30 bg-slate-800 p-5 shadow-2xl shadow-black/50 animate-[gate-rise_240ms_ease_both]">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="grid place-items-center w-9 h-9 rounded-full bg-sky-500/15 shrink-0">
            <Cloud size={18} className="text-sky-300" />
          </span>
          <h2 className="text-base font-bold text-white leading-tight">Guardá tus datos en la nube</h2>
        </div>
        <p className="text-sm text-slate-300 leading-snug">
          Con tu nombre y un código de 6 dígitos, tu planilla se respalda <span className="text-slate-100 font-medium">sola</span> cada
          pocos días y la podés recuperar en otro celular. Es gratis y lleva 10 segundos.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={onConfigurar}
            className="w-full py-3 rounded-xl bg-sky-600 text-white text-sm font-bold active:bg-sky-700 flex items-center justify-center gap-2"
          >
            <Cloud size={16} /> Configurar ahora
          </button>
          <button
            onClick={onMasTarde}
            className="w-full py-2.5 rounded-xl bg-slate-700 text-slate-300 text-sm font-medium active:bg-slate-600"
          >
            Más tarde
          </button>
        </div>
      </div>
    </div>
  )
}
