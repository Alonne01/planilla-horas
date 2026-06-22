import { useEffect, useState } from 'react'
import { QrCode, Share2, X, Copy, Check } from 'lucide-react'

// Botón flotante (abajo a la izquierda, espejo del FAB de exportar) que abre una tarjeta con el
// código QR de la app para compartirla, más un botón de "Compartir" (Web Share API + fallback a
// copiar el link). El QR se genera en el cliente (lib `qrcode`, import dinámico para no inflar el
// bundle inicial) con un logo centrado. Se OCULTA cuando aparece el beggar (prop `hidden`).

const SHARE_URL = window.location.origin + import.meta.env.BASE_URL
const LOGO = `${import.meta.env.BASE_URL}icons/icon-192.png`
const TITULO = 'Planilla de Horas'
const TEXTO = 'Registrá tus horas y tu sueldo con esta app.'

export function ShareQR({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Genera el QR la primera vez que se abre (teal sobre blanco, alta corrección para tolerar el logo).
  useEffect(() => {
    if (!open || qr) return
    let alive = true
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default
        const url = await QRCode.toDataURL(SHARE_URL, {
          errorCorrectionLevel: 'H',
          margin: 1,
          width: 480,
          color: { dark: '#0d5c54', light: '#ffffff' },
        })
        if (alive) setQr(url)
      } catch { /* sin red de generación: el modal igual muestra el link y compartir */ }
    })()
    return () => { alive = false }
  }, [open, qr])

  // Si aparece el beggar con el panel abierto, ciérralo.
  useEffect(() => {
    if (hidden && open) cerrar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden])

  function abrir() { setClosing(false); setOpen(true) }
  function cerrar() {
    setClosing(true)
    window.setTimeout(() => { setOpen(false); setClosing(false) }, 200)
  }

  async function compartir() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: TITULO, text: TEXTO, url: SHARE_URL }) }
      catch { /* el usuario canceló o falló: no hacemos nada */ }
    } else {
      void copiar()
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(SHARE_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard no disponible */ }
  }

  return (
    <>
      {/* Botón flotante — espejo del FAB de exportar (abajo a la izquierda). */}
      <button
        onClick={abrir}
        aria-label="Compartir la app"
        title="Compartir la app"
        className={`fixed bottom-20 left-4 z-40 w-12 h-12 rounded-full bg-slate-800/90 border border-slate-600/70 text-teal-300 shadow-lg flex items-center justify-center backdrop-blur transition-all duration-200 active:scale-95 animate-[qr-btn-in_240ms_ease_both] ${
          hidden ? 'opacity-0 scale-50 pointer-events-none' : 'opacity-100'
        }`}
      >
        <QrCode size={22} />
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm ${
            closing ? 'animate-[backdrop-fade-out_200ms_ease_both]' : 'animate-[backdrop-fade-in_180ms_ease_both]'
          }`}
          onClick={cerrar}
        >
          <div
            className={`w-full max-w-xs rounded-3xl bg-slate-800 border border-slate-600/70 shadow-2xl p-5 ${
              closing ? 'animate-[qr-card-out_200ms_ease_both]' : 'animate-[qr-card-in_240ms_cubic-bezier(0.34,1.56,0.64,1)_both]'
            }`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Share2 size={15} className="text-teal-300" /> Compartí la app
              </h3>
              <button onClick={cerrar} aria-label="Cerrar" className="text-slate-400 active:text-slate-200">
                <X size={18} />
              </button>
            </div>

            {/* Tarjeta del QR: fondo blanco, esquinas redondeadas, logo centrado. */}
            <div className="relative mx-auto w-56 h-56 rounded-2xl bg-white p-3 shadow-inner">
              {qr ? (
                <img
                  src={qr}
                  alt="Código QR de la app"
                  className="w-full h-full animate-[qr-reveal_300ms_ease_both]"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full grid place-items-center">
                  <QrCode size={56} className="text-slate-300 animate-pulse" />
                </div>
              )}
              {qr && (
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="rounded-xl bg-white p-1 shadow-md">
                    <img src={LOGO} alt="" className="w-11 h-11 rounded-lg" draggable={false} />
                  </div>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-slate-400 mt-3">
              Escaneá el código o enviá el link a tus compañeros.
            </p>

            <div className="mt-2 rounded-lg bg-slate-700/50 px-3 py-2 text-[11px] text-slate-300 text-center truncate" title={SHARE_URL}>
              {SHARE_URL.replace(/^https?:\/\//, '')}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={compartir}
                className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Share2 size={15} /> Compartir
              </button>
              <button
                onClick={copiar}
                aria-label="Copiar link"
                className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-all ${
                  copied ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200'
                }`}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
