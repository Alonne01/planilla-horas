import { useEffect, useRef, useState } from 'react'
import { X, Monitor, AlertTriangle, Check, Loader2, CameraOff } from 'lucide-react'
import { miDocIdNube, subirBackupNube } from '../lib/cloud-backup'
import { deriveSectionBits } from '../lib/section-crypto'
import { sellarPermiso, escribirSobre, type PayloadQR } from '../lib/pairing'

// Escáner de cámara — SÓLO teléfono. Lee el QR que muestra la PC (su clave pública ECDH efímera),
// pide confirmación y le "sella" un permiso cifrado (docId + K_shared) que deja en Firestore para que
// SÓLO esa PC pueda abrirlo. Nunca comparte el código ni la clave del sueldo (sección 'salary').

type Estado = 'escaneando' | 'confirmar' | 'vinculando' | 'ok' | 'error'

function nombreErrorCamara(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Permiso de cámara denegado. Habilitalo para escanear el código de la PC.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'No se encontró ninguna cámara en este dispositivo.'
  return 'No se pudo acceder a la cámara.'
}

export function EscanearPCQR({ usuario, codigo, onClose }: { usuario: string; codigo: string; onClose: () => void }) {
  const credsOk = !!usuario.trim() && /^\d{6}$/.test(codigo)

  const [estado, setEstado] = useState<Estado>('escaneando')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const pausadoRef = useRef(false)
  const payloadRef = useRef<PayloadQR | null>(null)

  useEffect(() => {
    if (!credsOk) return
    let cancelado = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    function detener() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      const s = streamRef.current
      if (s) { s.getTracks().forEach(t => t.stop()); streamRef.current = null }
    }

    function onDetect(data: string) {
      try {
        const p = JSON.parse(data) as PayloadQR
        if (p && p.v === 1 && typeof p.sid === 'string' && typeof p.pk === 'string') {
          pausadoRef.current = true
          payloadRef.current = p
          setEstado('confirmar')
        }
      } catch { /* no es nuestro QR: seguir escaneando */ }
    }

    void (async () => {
      let jsQR: typeof import('jsqr').default
      let stream: MediaStream
      try {
        jsQR = (await import('jsqr')).default
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch (e) {
        if (!cancelado) { setErrorMsg(nombreErrorCamara(e)); setEstado('error') }
        return
      }
      if (cancelado) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      const v = videoRef.current
      if (v) { v.srcObject = stream; try { await v.play() } catch { /* autoplay */ } }

      const tick = () => {
        if (cancelado) return
        const vv = videoRef.current
        if (!pausadoRef.current && vv && vv.readyState >= vv.HAVE_ENOUGH_DATA && ctx) {
          canvas.width = vv.videoWidth
          canvas.height = vv.videoHeight
          if (canvas.width && canvas.height) {
            ctx.drawImage(vv, 0, 0, canvas.width, canvas.height)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (code) onDetect(code.data)
          }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    })()

    return () => { cancelado = true; detener() }
  }, [credsOk])

  // Al volver a 'escaneando' (p.ej. tras Cancelar), el <video> se remonta: hay que re-enganchar
  // el stream (que sigue vivo) al nuevo elemento, o la vista queda negra y no reescanea.
  useEffect(() => {
    if (estado !== 'escaneando') return
    const v = videoRef.current
    const s = streamRef.current
    if (v && s && v.srcObject !== s) { v.srcObject = s; v.play().catch(() => { /* autoplay */ }) }
  }, [estado])

  function volverAEscanear() {
    payloadRef.current = null
    pausadoRef.current = false
    setEstado('escaneando')
  }

  async function vincular() {
    const payload = payloadRef.current
    if (!payload) return
    setEstado('vinculando')
    try {
      const docId = await miDocIdNube(usuario, codigo)
      const raw = await deriveSectionBits(usuario, codigo, 'shared')
      const kSharedB64 = btoa(String.fromCharCode(...new Uint8Array(raw)))
      const sobre = await sellarPermiso(payload.pk, { docId, kSharedB64, usuario })
      await escribirSobre(payload.sid, sobre, Date.now())
      // Aseguramos que la sección shared exista/esté al día en la nube para que la PC pueda restaurarla.
      await subirBackupNube(usuario, codigo, undefined, { soloSiCambio: true })
      setEstado('ok')
      window.setTimeout(onClose, 1600)
    } catch {
      setErrorMsg('No se pudo vincular la PC. Revisá tu conexión e intentá de nuevo.')
      setEstado('error')
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl shadow-black/50"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Monitor size={16} className="text-teal-300" /> Vincular una PC
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 active:text-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          {!credsOk ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertTriangle size={32} className="text-amber-400" />
              <p className="text-sm text-slate-300">
                Configurá primero tu cuenta de nube (nombre + código de 6 dígitos) para poder vincular una PC.
              </p>
              <button onClick={onClose} className="mt-1 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 active:bg-slate-600">
                Entendido
              </button>
            </div>
          ) : estado === 'error' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CameraOff size={32} className="text-red-400" />
              <p className="text-sm text-slate-300">{errorMsg}</p>
              <button onClick={onClose} className="mt-1 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 active:bg-slate-600">
                Cerrar
              </button>
            </div>
          ) : estado === 'ok' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
                <Check size={30} />
              </div>
              <p className="text-base font-bold text-white">PC vinculada</p>
              <p className="text-sm text-slate-400">Ya podés usar tus horas en la PC.</p>
            </div>
          ) : estado === 'confirmar' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-teal-500/15 text-teal-300">
                <Monitor size={28} />
              </div>
              <p className="text-base font-bold text-white">¿Vincular esta PC?</p>
              <p className="text-sm text-slate-400">
                Podrá ver y editar tus horas, <span className="font-semibold text-slate-300">sin el sueldo</span>.
              </p>
              <div className="mt-2 flex w-full gap-2">
                <button onClick={volverAEscanear} className="flex-1 rounded-xl bg-slate-700 py-2.5 text-sm font-medium text-slate-200 active:bg-slate-600">
                  Cancelar
                </button>
                <button onClick={vincular} className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white active:bg-teal-700">
                  Vincular
                </button>
              </div>
            </div>
          ) : (
            // escaneando / vinculando
            <div className="flex flex-col items-center gap-3">
              <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                {/* Marco guía */}
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="h-44 w-44 rounded-2xl border-2 border-teal-300/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
                {estado === 'vinculando' && (
                  <div className="absolute inset-0 grid place-items-center bg-black/60">
                    <div className="flex flex-col items-center gap-2 text-teal-200">
                      <Loader2 size={30} className="animate-spin" />
                      <span className="text-sm font-medium">Vinculando…</span>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-center text-xs text-slate-400">
                Apuntá la cámara al código QR que muestra la PC.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
