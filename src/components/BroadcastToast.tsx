import { useEffect } from 'react'
import peaceChar from '../assets/peace-sheet.png'

// El spritesheet "peace-sheet": 2 cuadros horizontales (neutro ↔ guiño + seña de paz), 3:4 portrait
// cada uno. Se reproduce a 2 fps (cada cuadro 500 ms) con el keyframe `peace-idle` (ver index.css).
const FRAMES = 2
const PIXEL_FONT = "'Press Start 2P', monospace"

/**
 * Cartel de DIFUSIÓN: un mensaje que el admin manda a todos. Mismo estilo pixel-art que UpdateToast
 * pero un poco más grande, con el personaje "peace" animado a 2 fps. A diferencia del de
 * actualización, NO recarga ni se cierra solo: espera que el usuario toque "OK" (o fuera) — así se
 * marca como visto y no vuelve a aparecer (`onClose` persiste el id en App).
 */
export function BroadcastToast({ titulo, cuerpo, onClose }: { titulo: string; cuerpo: string; onClose: () => void }) {
  useEffect(() => {
    // Fuente pixelart (Press Start 2P) — compartida con UpdateToast; se inyecta una sola vez.
    if (!document.getElementById('pixel-font-pressstart')) {
      const l = document.createElement('link')
      l.id = 'pixel-font-pressstart'
      l.rel = 'stylesheet'
      l.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'
      document.head.appendChild(l)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {/* Backdrop que bloquea y oscurece para que el mensaje se lea; al tocarlo se cierra (se da por visto). */}
      <div className="absolute inset-0 bg-black/55 animate-[backdrop-fade-in_200ms_ease_both]" onClick={onClose} />

      {/* Panel pixel: borde grueso, esquinas duras, sombra dura. Más grande que el de actualización. */}
      <div
        className="relative flex w-full max-w-md items-start gap-4 border-[3px] border-emerald-300/80 bg-slate-900 p-4 pr-5 animate-[gate-rise_280ms_ease_both]"
        style={{ boxShadow: '5px 5px 0 0 rgba(0,0,0,0.6)' }}
      >
        {/* El sheet tiene fondo negro opaco (no recortable: el pelo del personaje también es negro),
            así que se enmarca sobre negro a propósito, como un retrato. */}
        <div
          className="shrink-0 border-2 border-emerald-300/40 bg-black"
          style={{
            width: 84,
            height: 112,
            backgroundImage: `url(${peaceChar})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${FRAMES * 100}% 100%`,
            animation: 'peace-idle 1s steps(2) infinite', // 2 cuadros / 1 s = 2 fps
          }}
        />
        <div className="min-w-0 flex-1" style={{ fontFamily: PIXEL_FONT }}>
          <p className="text-emerald-300" style={{ fontSize: 11, lineHeight: 1.5 }}>{titulo || 'MENSAJE'}</p>
          {cuerpo && (
            <p className="mt-2.5 whitespace-pre-wrap break-words text-slate-100" style={{ fontSize: 8, lineHeight: 1.75 }}>
              {cuerpo}
            </p>
          )}
          <div className="mt-3.5 flex justify-end">
            <button
              onClick={onClose}
              className="border-2 border-emerald-300/70 bg-emerald-500/10 px-5 py-2 text-emerald-200 active:bg-emerald-500/25"
              style={{ fontFamily: PIXEL_FONT, fontSize: 9 }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
