import type { ResumenHoras } from '../lib/calculo-horas'

interface Props {
  resumen: ResumenHoras
  francosDisponibles: number
}

function HorasChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex-1 rounded-xl p-3 bg-slate-800/80 border border-slate-700/50`}>
      <div className={`text-xl font-bold ${color}`}>{value.toFixed(1)}</div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

export function ResumenBar({ resumen, francosDisponibles }: Props) {
  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex gap-2">
        <HorasChip label="Normales" value={resumen.horasNormales} color="text-white" />
        <HorasChip label="Al 50%" value={resumen.horasAl50} color="text-amber-300" />
        <HorasChip label="Al 100%" value={resumen.horasAl100} color="text-orange-400" />
        {resumen.horasViaje > 0 && (
          <HorasChip label="Viaje" value={resumen.horasViaje} color="text-slate-300" />
        )}
      </div>

      <div className="flex items-center justify-between bg-slate-800/80 rounded-xl px-4 py-3 border border-slate-700/50">
        <div>
          <div className="text-xs text-slate-400">Total trabajadas</div>
          <div className="text-lg font-bold text-white">{resumen.totalHorasTrabajadas.toFixed(1)} hs</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Franco comp. disponibles</div>
          <div className={`text-lg font-bold ${francosDisponibles > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
            {francosDisponibles}
          </div>
        </div>
      </div>
    </div>
  )
}
