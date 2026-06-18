import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { Clock, CalendarDays, Download, Cloud, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

interface Slide {
  icon: LucideIcon
  color: string
  titulo: string
  texto: ReactNode
}

const SLIDES: Slide[] = [
  {
    icon: Clock,
    color: 'text-blue-400 bg-blue-600/20',
    titulo: 'Bienvenido',
    texto: <>Esta app te ayuda a llevar tus <strong className="text-slate-200">horas de trabajo</strong> y exportarlas a Excel. Te muestro lo básico en cuatro pasos.</>,
  },
  {
    icon: CalendarDays,
    color: 'text-emerald-400 bg-emerald-600/20',
    titulo: 'Cargá tus días',
    texto: <>Tocá un día del calendario y poné la <strong className="text-slate-200">entrada y salida</strong>, o marcá una <strong className="text-slate-200">ausencia</strong> (compensatorio, ausencia, falta o vacaciones). Mantené pulsado un día para <strong className="text-slate-200">copiarlo</strong> a otros.</>,
  },
  {
    icon: Download,
    color: 'text-sky-400 bg-sky-600/20',
    titulo: 'Exportá a Excel',
    texto: <>Con el mes cargado, tocá el botón azul de abajo a la derecha y elegí <strong className="text-slate-200">"Normal (planilla)"</strong> para descargar tu planilla lista para enviar.</>,
  },
  {
    icon: Cloud,
    color: 'text-indigo-400 bg-indigo-600/20',
    titulo: 'Respaldo en la nube',
    texto: <>Tu planilla se <strong className="text-slate-200">respalda sola</strong> cada pocos días con tu nombre + código. Si cambiás de celular, la recuperás desde Configuración con esos datos.</>,
  },
]

/** Tutorial simple: carrusel de diapositivas. No bloquea acciones críticas; se puede saltar y
 *  reabrir desde el menú ⋮. Reemplaza al tour spotlight guiado. */
export function TutorialSlides({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState(0)
  const dragStart = useRef<number | null>(null)
  const esUltimo = idx === SLIDES.length - 1
  const s = SLIDES[idx]
  const Icono = s.icon

  function avanzar() { esUltimo ? onClose() : setIdx(i => Math.min(SLIDES.length - 1, i + 1)) }
  function retroceder() { setIdx(i => Math.max(0, i - 1)) }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) { dragStart.current = e.clientX }
  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    dragStart.current = null
    if (start == null) return
    const dx = e.clientX - start
    if (dx < -45) avanzar()
    else if (dx > 45) retroceder()
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-5 animate-[backdrop-fade-in_200ms_ease_both]">
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-2xl shadow-black/50 animate-[gate-rise_240ms_ease_both]"
        onPointerDown={onDown}
        onPointerUp={onUp}
      >
        {/* Encabezado: paginación + Saltar */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${i === idx ? 'w-5 bg-blue-400' : 'w-1.5 bg-slate-600'}`}
              />
            ))}
          </div>
          <button onClick={onClose} className="text-xs font-medium text-slate-400 active:text-slate-200">
            {esUltimo ? 'Cerrar' : 'Saltar'}
          </button>
        </div>

        {/* Diapositiva */}
        <div key={idx} className="animate-[view-fade-in_220ms_ease_both]">
          <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl ${s.color}`}>
            <Icono size={32} />
          </div>
          <h2 className="text-center text-lg font-bold text-white">{s.titulo}</h2>
          <p className="mt-2 min-h-[5.5rem] text-center text-sm leading-snug text-slate-300">{s.texto}</p>
        </div>

        {/* Navegación */}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={retroceder}
            disabled={idx === 0}
            className="flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition-opacity active:text-white disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeft size={16} /> Atrás
          </button>
          <div className="flex-1" />
          <button
            onClick={avanzar}
            className="flex items-center gap-1 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors active:bg-blue-700"
          >
            {esUltimo ? 'Listo' : <>Siguiente <ChevronRight size={16} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
