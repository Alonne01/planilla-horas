import { useState, useRef } from 'react'
import { X } from 'lucide-react'

const ITEM_H = 44
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

interface DrumColProps {
  items: string[]
  value: string
  onChange: (v: string) => void
}

function DrumCol({ items, value, onChange }: DrumColProps) {
  const idx = Math.max(0, items.indexOf(value))
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startY = useRef(0)
  const startIdx = useRef(0)

  const liveIdx = isDragging
    ? Math.max(0, Math.min(items.length - 1, Math.round(startIdx.current - dragOffset / ITEM_H)))
    : idx

  const translate = isDragging
    ? ITEM_H - startIdx.current * ITEM_H + dragOffset
    : ITEM_H - idx * ITEM_H

  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY
    startIdx.current = idx
    setIsDragging(true)
    setDragOffset(0)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!isDragging) return
    setDragOffset(e.clientY - startY.current)
  }

  function onPointerUp(e: React.PointerEvent) {
    const dy = e.clientY - startY.current
    const snappedIdx = Math.max(0, Math.min(items.length - 1, Math.round(startIdx.current - dy / ITEM_H)))
    setIsDragging(false)
    setDragOffset(0)
    if (items[snappedIdx] !== value) onChange(items[snappedIdx])
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{ height: ITEM_H * 3, width: 56, touchAction: 'none', userSelect: 'none', cursor: 'ns-resize' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        style={{
          transform: `translateY(${translate}px)`,
          transition: isDragging ? 'none' : 'transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          willChange: 'transform',
        }}
      >
        {items.map((item, i) => (
          <div key={item} className="flex items-center justify-center font-mono" style={{ height: ITEM_H }}>
            <span
              className={
                i === liveIdx
                  ? 'text-white text-2xl font-bold'
                  : 'text-slate-500 text-base'
              }
            >
              {item}
            </span>
          </div>
        ))}
      </div>

      {/* Center selection indicator */}
      <div
        className="absolute inset-x-0 pointer-events-none border-t border-b border-blue-500/50"
        style={{ top: ITEM_H, height: ITEM_H }}
      />
      {/* Top gradient */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: ITEM_H, background: 'linear-gradient(to bottom, #1e293b, transparent)' }}
      />
      {/* Bottom gradient */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{ height: ITEM_H, background: 'linear-gradient(to top, #1e293b, transparent)' }}
      />
    </div>
  )
}

interface TimeDrumPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
}

export function TimeDrumPicker({ label, value, onChange }: TimeDrumPickerProps) {
  const hasValue = value !== ''
  const parts = hasValue ? value.split(':') : ['08', '00']
  const hStr = parts[0] ?? '08'
  const mStr = (['00', '15', '30', '45'].includes(parts[1] ?? '') ? parts[1] : '00') as string

  return (
    <div className="flex-1">
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      <div className="bg-slate-700 rounded-xl overflow-hidden relative">
        {hasValue && (
          <button
            onPointerDown={e => { e.stopPropagation(); onChange('') }}
            className="absolute top-1 right-1 z-10 text-slate-500 active:text-white p-1"
          >
            <X size={12} />
          </button>
        )}
        {!hasValue ? (
          <div
            className="flex items-center justify-center h-[132px] text-slate-500 text-2xl font-mono tracking-widest"
            onPointerDown={() => onChange('08:00')}
          >
            -- : --
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1">
            <DrumCol items={HOURS} value={hStr} onChange={h => onChange(`${h}:${mStr}`)} />
            <span className="text-slate-400 text-2xl font-bold select-none">:</span>
            <DrumCol items={MINUTES} value={mStr} onChange={m => onChange(`${hStr}:${m}`)} />
          </div>
        )}
      </div>
    </div>
  )
}
