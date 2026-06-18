import { useEffect, useRef, useState } from 'react'
import type { ResumenHoras } from '../lib/calculo-horas'

interface Props {
  resumen: ResumenHoras
  francosDisponibles: number
}

const reduceMotion = typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Anima un número desde su valor mostrado actual hasta `target` (easeOutCubic, ~600 ms). */
function useCountUp(target: number, duration = 600): number {
  const [val, setVal] = useState(target)
  const valRef = useRef(target)
  valRef.current = val
  useEffect(() => {
    const from = valRef.current
    if (reduceMotion || Math.abs(from - target) < 0.001) { setVal(target); return }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else setVal(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function HorasChip({ label, value, color }: { label: string; value: number; color: string }) {
  const shown = useCountUp(value)
  return (
    <div className="flex-1 rounded-xl p-3 sm:p-2 bg-slate-800/80 border border-slate-700/50">
      <div className={`text-xl sm:text-lg font-bold tabular-nums ${color}`}>{shown.toFixed(1)}</div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

export function ResumenBar({ resumen, francosDisponibles }: Props) {
  const totalShown = useCountUp(resumen.totalHorasTrabajadas)
  const francoShown = useCountUp(francosDisponibles)
  // El "Total trabajadas" GANA INTENSIDAD (glow azul) a medida que sube hacia un mes completo (~200 h).
  const intensidad = Math.min(1, resumen.totalHorasTrabajadas / 200)
  return (
    <div className="px-4 py-3 sm:py-2 space-y-3 sm:space-y-2">
      <div className="flex gap-2">
        <HorasChip label="Normales" value={resumen.horasNormales} color="text-white" />
        <HorasChip label="Al 50%" value={resumen.horasAl50} color="text-amber-300" />
        <HorasChip label="Al 100%" value={resumen.horasAl100} color="text-orange-400" />
        {resumen.horasViaje > 0 && (
          <HorasChip label="Viaje" value={resumen.horasViaje} color="text-slate-300" />
        )}
      </div>

      <div className="flex items-center justify-between bg-slate-800/80 rounded-xl px-4 py-3 sm:py-2 border border-slate-700/50">
        <div>
          <div className="text-xs text-slate-400">Total trabajadas</div>
          <div
            className="text-lg font-bold text-white tabular-nums transition-[text-shadow] duration-500"
            style={{ textShadow: intensidad > 0.05 ? `0 0 ${8 + intensidad * 14}px rgba(96,165,250,${0.2 + intensidad * 0.55})` : undefined }}
          >
            {totalShown.toFixed(1)} hs
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Franco comp. disponibles</div>
          <div className={`text-lg font-bold tabular-nums ${francosDisponibles > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
            {Math.round(francoShown)}
          </div>
        </div>
      </div>
    </div>
  )
}
