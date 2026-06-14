import { useEffect, useState } from 'react'
import { useOnboarding } from '../onboarding/OnboardingContext'

/**
 * Overlay del tour: dibuja un glow sobre el elemento `target` del paso actual y
 * una tarjeta con el texto + navegación. El overlay deja pasar los toques
 * (pointer-events-none) salvo la tarjeta, así el usuario puede interactuar con
 * el elemento resaltado (escribir el nombre, elegir diagrama, etc.).
 */
export function GuideTooltip() {
  const { activo, paso, pasoIdx, total, next, back, skip } = useOnboarding()
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!activo || !paso?.target) { setRect(null); return }
    const sel = paso.target
    let raf = 0
    let tries = 0
    let alive = true
    function buscar() {
      if (!alive) return
      const el = document.querySelector(sel) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => { if (alive) setRect(el.getBoundingClientRect()) }, 220)
      } else if (tries++ < 40) {
        raf = requestAnimationFrame(buscar)
      } else {
        setRect(null)
      }
    }
    setRect(null)
    buscar()
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [activo, paso])

  // Reposicionar el glow en scroll/resize mientras el target exista
  useEffect(() => {
    if (!rect || !paso?.target) return
    const sel = paso.target
    function upd() {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', upd)
    window.addEventListener('scroll', upd, true)
    return () => { window.removeEventListener('resize', upd); window.removeEventListener('scroll', upd, true) }
  }, [rect, paso])

  if (!activo || !paso) return null

  const esPrimero = pasoIdx === 0
  const esUltimo = pasoIdx === total - 1
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  // La tarjeta va abajo, salvo que el target esté en la mitad inferior → va arriba.
  const cardAbajo = !rect || rect.top + rect.height / 2 < vh * 0.55

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Glow sobre el target */}
      {rect && (
        <div
          className="tour-glow pointer-events-none absolute rounded-xl"
          style={{
            left: Math.max(2, rect.left - 6),
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}

      {/* Tarjeta guía */}
      <div
        className="pointer-events-auto fixed inset-x-3 mx-auto max-w-sm rounded-2xl border border-sky-500/30 bg-slate-800/95 p-4 shadow-2xl shadow-black/50 backdrop-blur animate-[gate-rise_240ms_ease_both]"
        style={cardAbajo
          ? { bottom: 'calc(5rem + env(safe-area-inset-bottom))' }
          : { top: 'calc(env(safe-area-inset-top) + 1rem)' }}
      >
        {paso.titulo && (
          <p className="text-sm font-bold text-sky-300">{paso.titulo}</p>
        )}
        <p className="mt-1 text-sm leading-snug text-slate-200">{paso.texto}</p>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-slate-500">{pasoIdx + 1}/{total}</span>
          <div className="flex-1" />
          {!esUltimo && (
            <button onClick={skip} className="px-2 py-1.5 text-xs font-medium text-slate-400 active:text-slate-200">
              Saltar
            </button>
          )}
          {!esPrimero && (
            <button onClick={back} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 active:bg-slate-600">
              Atrás
            </button>
          )}
          <button onClick={next} className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-bold text-white active:bg-sky-700">
            {esUltimo ? 'Terminar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}
