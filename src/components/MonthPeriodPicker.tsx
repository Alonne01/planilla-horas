import { useState } from 'react'
import { X } from 'lucide-react'
import { MESES_ES, periodoStart, periodoEnd, defaultPeriodoMes, defaultPeriodoAnio } from '../lib/diagrama'

// Selector de período tipo "calendario de meses": alternativa a las flechas ‹ ›. Se abre al tocar
// el rótulo del período en la cabecera. Cada celda es un período etiquetado por su span de dos meses
// (ej. "Jun–Jul") más el nombre del mes de cierre. Reutilizable en Horas / Análisis / Sueldo.

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** Span de dos meses del período (mes,anio): ej. "Jun–Jul". Usa los límites reales (cierres variables). */
function spanLabel(mes: number, anio: number): string {
  const s = periodoStart(mes, anio).getMonth()
  const e = periodoEnd(mes, anio).getMonth()
  return `${MESES_SHORT[s]}–${MESES_SHORT[e]}`
}

export function MonthPeriodPicker({ mes, anio, onSelect, onClose }: {
  mes: number
  anio: number
  onSelect: (mes: number, anio: number) => void
  onClose: () => void
}) {
  const [year, setYear] = useState(anio)
  const [closing, setClosing] = useState(false)
  const hoyMes = defaultPeriodoMes()
  const hoyAnio = defaultPeriodoAnio()

  function cerrar() { setClosing(true); window.setTimeout(onClose, 180) }
  function elegir(m: number) { onSelect(m, year); cerrar() }

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm ${
        closing ? 'animate-[backdrop-fade-out_180ms_ease_both]' : 'animate-[backdrop-fade-in_180ms_ease_both]'
      }`}
      onClick={cerrar}
    >
      <div
        className={`w-full max-w-xs rounded-3xl bg-slate-800 border border-slate-600/70 shadow-2xl p-5 ${
          closing ? 'animate-[qr-card-out_180ms_ease_both]' : 'animate-[qr-card-in_220ms_cubic-bezier(0.34,1.56,0.64,1)_both]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setYear(y => y - 1)} aria-label="Año anterior" className="p-2 text-slate-400 active:text-white text-xl leading-none">‹</button>
          <span className="text-base font-bold text-white tabular-nums">{year}</span>
          <button onClick={() => setYear(y => y + 1)} aria-label="Año siguiente" className="p-2 text-slate-400 active:text-white text-xl leading-none">›</button>
          <button onClick={cerrar} aria-label="Cerrar" className="ml-1 text-slate-400 active:text-slate-200"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, m) => {
            const sel = m === mes && year === anio
            const esHoy = m === hoyMes && year === hoyAnio
            return (
              <button
                key={m}
                onClick={() => elegir(m)}
                className={`relative rounded-xl py-2.5 px-1 flex flex-col items-center transition-colors active:scale-95 ${
                  sel ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-700/60 text-slate-200 active:bg-slate-600'
                } ${esHoy && !sel ? 'ring-1 ring-blue-400/60' : ''}`}
              >
                <span className="text-sm font-semibold leading-tight">{spanLabel(m, year)}</span>
                <span className={`text-[10px] leading-tight ${sel ? 'text-blue-100' : 'text-slate-400'}`}>{MESES_ES[m]}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
