import { useEffect, useRef, useState } from 'react'
import { Smartphone, QrCode, Monitor, ArrowLeft, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import {
  generarParPC, exportarPub, abrirPermiso, nuevoSid, leerSobre, borrarSobre, type PayloadQR,
} from '../lib/pairing'
import { crearDesdePermiso, guardarSesion, limpiarSesion, type PCSession } from '../lib/pc-session'
import { restaurarSharedDoc } from '../lib/cloud-backup'

// Pantalla-gate a pantalla completa que se muestra SÓLO en PC (no-teléfono) sin sesión vinculada.
// La cuenta se crea siempre desde el teléfono; la PC es un dispositivo compañero efímero (estilo
// WhatsApp Web): muestra un QR con su clave pública ECDH y espera a que el teléfono le "selle" un
// permiso cifrado en Firestore. El cálculo salarial NUNCA vive ni se muestra en PC.

const SHARE_URL = window.location.origin + import.meta.env.BASE_URL

type Vista = 'menu' | 'nueva' | 'pair'

export function PairGate({ onVinculada }: { onVinculada: (s: PCSession) => void }) {
  const [vista, setVista] = useState<Vista>('menu')

  return (
    <div className="relative min-h-screen overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Fondo: orbes a la deriva (acento teal, coherente con el QR de compartir) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-teal-500/20 blur-3xl animate-[blob-drift-a_14s_ease-in-out_infinite]" />
        <div className="absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-emerald-500/15 blur-3xl animate-[blob-drift-b_18s_ease-in-out_infinite]" />
        <div className="absolute -bottom-28 left-1/4 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl animate-[blob-drift-c_16s_ease-in-out_infinite]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          {vista === 'menu' && <Menu onNueva={() => setVista('nueva')} onPair={() => setVista('pair')} />}
          {vista === 'nueva' && <Nueva onVolver={() => setVista('menu')} />}
          {vista === 'pair' && <Pair onVolver={() => setVista('menu')} onVinculada={onVinculada} />}
        </div>
      </div>
    </div>
  )
}

function Menu({ onNueva, onPair }: { onNueva: () => void; onPair: () => void }) {
  return (
    <div className="flex flex-col items-center animate-[gate-rise_400ms_ease_both]">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-teal-500/15 text-teal-300">
        <Monitor size={30} />
      </div>
      <h1 className="mb-1 text-center text-2xl font-extrabold text-white">Vinculá esta PC</h1>
      <p className="mb-8 max-w-xs text-center text-sm text-slate-400">
        Tu cuenta vive en el teléfono. La PC se vincula de forma temporal para ver y cargar tus horas.
        El cálculo del sueldo queda solamente en el teléfono.
      </p>

      <div className="w-full space-y-3">
        <button
          onClick={onPair}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 py-4 text-base font-bold text-white shadow-lg shadow-teal-600/20 transition-colors active:bg-teal-700"
        >
          <QrCode size={18} /> Ingresar desde teléfono
        </button>
        <button
          onClick={onNueva}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-600 bg-slate-800/80 py-3.5 text-sm font-semibold text-slate-100 transition-all active:scale-[0.98] hover:border-slate-500 hover:bg-slate-700/80"
        >
          <Smartphone size={18} /> Cuenta nueva
        </button>
      </div>

      <p className="mt-6 select-none text-center text-xs text-slate-600">
        Planilla de Horas · by Nicolás Vázquez
      </p>
    </div>
  )
}

// "Cuenta nueva": no se pueden crear cuentas desde la PC. Se muestra el QR de INSTALACIÓN de la app
// para que el usuario la instale y cree su cuenta en el teléfono.
function Nueva({ onVolver }: { onVolver: () => void }) {
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default
        const url = await QRCode.toDataURL(SHARE_URL, {
          errorCorrectionLevel: 'H', margin: 1, width: 360, color: { dark: '#0d5c54', light: '#ffffff' },
        })
        if (alive) setQr(url)
      } catch { /* sin generación: igual mostramos el link */ }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="flex flex-col items-center animate-[gate-rise_360ms_ease_both]">
      <h1 className="mb-1 text-center text-xl font-extrabold text-white">Creá tu cuenta en el teléfono</h1>
      <p className="mb-6 max-w-xs text-center text-sm text-slate-400">
        Escaneá este código con tu teléfono para instalar la app. Creá tu cuenta ahí y después
        volvé a vincular esta PC.
      </p>

      <QrCard qr={qr} alt="Código para instalar la app" />

      <div className="mt-3 w-full max-w-[15rem] truncate rounded-lg bg-slate-800/70 px-3 py-2 text-center text-[11px] text-slate-300" title={SHARE_URL}>
        {SHARE_URL.replace(/^https?:\/\//, '')}
      </div>

      <button
        onClick={onVolver}
        className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-slate-800/80 px-5 py-3 text-sm font-semibold text-slate-100 transition-all active:scale-95 hover:bg-slate-700/80"
      >
        <ArrowLeft size={16} /> Volver
      </button>
    </div>
  )
}

// "Ingresar desde teléfono": genera un par ECDH efímero (privada SÓLO en RAM, en un ref), muestra su
// clave pública en un QR y hace polling del "sobre" cifrado que deja el teléfono. Al abrirlo, crea la
// sesión de PC (1 día sliding) y restaura la sección shared (sin sueldo).
function Pair({ onVolver, onVinculada }: { onVolver: () => void; onVinculada: (s: PCSession) => void }) {
  const [qr, setQr] = useState<string | null>(null)
  const [expirado, setExpirado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vinculando, setVinculando] = useState(false)
  const [gen, setGen] = useState(0) // bump → regenera el QR/sid
  const privRef = useRef<CryptoKey | null>(null)

  useEffect(() => {
    let alive = true
    let consumido = false
    let intervalId: number | undefined
    let timeoutId: number | undefined

    void (async () => {
      setQr(null); setExpirado(false); setError(null); setVinculando(false)
      try {
        const par = await generarParPC()
        privRef.current = par.privateKey
        const sid = nuevoSid()
        const pk = await exportarPub(par.publicKey)
        const QRCode = (await import('qrcode')).default
        const payload: PayloadQR = { v: 1, sid, pk }
        const url = await QRCode.toDataURL(JSON.stringify(payload), {
          errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#0d5c54', light: '#ffffff' },
        })
        if (!alive) return
        setQr(url)

        // A los 2 min el handshake caduca (coincide con el TTL del sobre en Firestore).
        timeoutId = window.setTimeout(() => {
          setExpirado(true)
          if (intervalId) window.clearInterval(intervalId)
        }, 120_000)

        // Polling cada 2 s: en cuanto aparece el sobre, se abre y se vincula.
        intervalId = window.setInterval(() => {
          if (consumido) return
          void (async () => {
            let sobre
            try { sobre = await leerSobre(sid, Date.now()) } catch { return }
            if (!sobre || consumido) return
            consumido = true
            if (intervalId) window.clearInterval(intervalId)
            if (timeoutId) window.clearTimeout(timeoutId)
            setVinculando(true)
            try {
              const permiso = await abrirPermiso(privRef.current!, sobre)
              await borrarSobre(sid)
              const sesion = crearDesdePermiso(permiso, Date.now())
              guardarSesion(sesion)
              const raw = Uint8Array.from(atob(permiso.kSharedB64), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
              const r = await restaurarSharedDoc(permiso.docId, raw)
              if (r === 'incompatible') { setError('Sincronizá primero desde el teléfono'); limpiarSesion(); setVinculando(false); return }
              if (r === 'no-existe' || r === 'clave-incorrecta') { setError('No se pudo vincular. Reintentá.'); limpiarSesion(); setVinculando(false); return }
              onVinculada(sesion)
            } catch {
              setError('No se pudo vincular. Reintentá.')
              setVinculando(false)
            }
          })()
        }, 2000)
      } catch {
        if (alive) setError('No se pudo generar el código. Reintentá.')
      }
    })()

    return () => {
      alive = false
      if (intervalId) window.clearInterval(intervalId)
      if (timeoutId) window.clearTimeout(timeoutId)
    }
    // onVinculada es un setState estable; sólo re-generamos al bumpear `gen`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen])

  function regenerar() {
    setGen(g => g + 1)
  }

  return (
    <div className="flex flex-col items-center animate-[gate-rise_360ms_ease_both]">
      <h1 className="mb-1 text-center text-xl font-extrabold text-white">Escaneá desde tu teléfono</h1>
      <p className="mb-6 max-w-xs text-center text-sm text-slate-400">
        En la app del teléfono, entrá a <span className="font-semibold text-slate-200">Configuración → Vincular una PC</span> y
        escaneá este código.
      </p>

      <div className="relative">
        <QrCard qr={qr} alt="Código para vincular la PC" dim={expirado || vinculando || !!error} />
        {(vinculando || (!qr && !error)) && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 size={34} className="animate-spin text-teal-300" />
          </div>
        )}
      </div>

      {vinculando && <p className="mt-4 text-sm font-medium text-teal-300">Vinculando…</p>}

      {error && !vinculando && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {expirado && !vinculando && !error && (
        <p className="mt-4 text-sm text-amber-300">El código expiró.</p>
      )}

      {(expirado || error) && !vinculando && (
        <button
          onClick={regenerar}
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-teal-600 px-5 py-3 text-sm font-bold text-white transition-colors active:bg-teal-700"
        >
          <RefreshCw size={16} /> Regenerar QR
        </button>
      )}

      <button
        onClick={onVolver}
        className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-slate-800/80 px-5 py-3 text-sm font-semibold text-slate-100 transition-all active:scale-95 hover:bg-slate-700/80"
      >
        <ArrowLeft size={16} /> Volver
      </button>
    </div>
  )
}

// Tarjeta blanca con el QR (o placeholder mientras se genera). Reutilizada por ambas vistas.
function QrCard({ qr, alt, dim = false }: { qr: string | null; alt: string; dim?: boolean }) {
  return (
    <div className="relative mx-auto h-60 w-60 rounded-2xl bg-white p-3 shadow-inner">
      {qr ? (
        <img
          src={qr}
          alt={alt}
          draggable={false}
          className={`h-full w-full transition-opacity duration-200 ${dim ? 'opacity-30' : 'animate-[qr-reveal_300ms_ease_both]'}`}
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <QrCode size={56} className="animate-pulse text-slate-300" />
        </div>
      )}
    </div>
  )
}
