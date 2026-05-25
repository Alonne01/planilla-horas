import { useEffect, useRef } from 'react'

interface Props {
  x: number
  y: number
  date: Date
  hasData: boolean
  onCopyPrevious: () => void
  onCopyToAll: () => void
  onClose: () => void
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function ContextMenu({ x, y, date, hasData, onCopyPrevious, onCopyToAll, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Clamp so menu stays on screen
  useEffect(() => {
    if (!menuRef.current) return
    const r = menuRef.current.getBoundingClientRect()
    const maxX = window.innerWidth - r.width - 8
    const maxY = window.innerHeight - r.height - 8
    if (x > maxX) menuRef.current.style.left = `${maxX}px`
    if (y > maxY) menuRef.current.style.top = `${maxY}px`
  }, [x, y])

  const dateLabel = `${DIAS[date.getDay()]} ${date.getDate()} ${MESES[date.getMonth()]}`

  return (
    <>
      {/* Backdrop to close */}
      <div
        className="fixed inset-0 z-50"
        onPointerDown={onClose}
        onContextMenu={e => { e.preventDefault(); onClose() }}
      />
      <div
        ref={menuRef}
        className="fixed z-50 bg-slate-800 border border-slate-600/70 rounded-2xl shadow-2xl overflow-hidden min-w-[190px]"
        style={{ left: x, top: y }}
      >
        <div className="px-4 py-2.5 text-xs text-slate-400 border-b border-slate-700 font-medium">
          {dateLabel}
        </div>
        <button
          onPointerDown={e => { e.stopPropagation(); onCopyPrevious(); onClose() }}
          className="w-full text-left px-4 py-3 text-sm text-white active:bg-slate-700 flex items-center gap-3"
        >
          <span className="text-base">📋</span>
          <span>Copiar día anterior</span>
        </button>
        {hasData && (
          <button
            onPointerDown={e => { e.stopPropagation(); onCopyToAll(); onClose() }}
            className="w-full text-left px-4 py-3 text-sm text-white active:bg-slate-700 flex items-center gap-3 border-t border-slate-700/50"
          >
            <span className="text-base">🗂️</span>
            <span>Copiar a días hábiles</span>
          </button>
        )}
      </div>
    </>
  )
}
