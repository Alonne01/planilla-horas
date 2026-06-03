import { usePWAInstall } from '../hooks/usePWAInstall'
import { Smartphone, Share, MoreVertical, Monitor, ShieldCheck, Zap, AlertTriangle } from 'lucide-react'

interface Props {
  onSkip: () => void
}

export function InstallGate({ onSkip }: Props) {
  const { canInstall, install, isIOS } = usePWAInstall()

  const ua = navigator.userAgent
  const isAndroid = /android/i.test(ua)
  const isFirefox = /firefox/i.test(ua)
  const isSamsungBrowser = /samsungbrowser/i.test(ua)

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center px-6 py-10">
      {/* Fondo animado: orbes de gradiente a la deriva */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-20 w-72 h-72 rounded-full bg-sky-500/20 blur-3xl animate-[blob-drift-a_14s_ease-in-out_infinite]" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full bg-emerald-500/15 blur-3xl animate-[blob-drift-b_18s_ease-in-out_infinite]" />
        <div className="absolute -bottom-28 left-1/4 w-72 h-72 rounded-full bg-violet-500/15 blur-3xl animate-[blob-drift-c_16s_ease-in-out_infinite]" />
      </div>

      {/* Contenido */}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center animate-[gate-rise_400ms_ease_both]">
        {/* Logo con halo */}
        <div className="relative mb-5">
          <div aria-hidden className="absolute inset-0 -z-10 rounded-3xl bg-sky-500/30 blur-2xl scale-110" />
          <img
            src="/icons/icon-512.svg"
            alt="Planilla de Horas"
            className="w-24 h-24 rounded-2xl shadow-xl ring-1 ring-white/10"
          />
        </div>
        <h1 className="text-3xl font-extrabold text-center mb-1 bg-gradient-to-br from-sky-200 via-white to-emerald-200 bg-clip-text text-transparent">
          Planilla de Horas
        </h1>
        <p className="text-slate-400 text-sm text-center mb-8 max-w-xs">
          Para usar la app y proteger tus datos, instalala en tu dispositivo.
        </p>

        {/* Why install */}
        <div className="w-full bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-4 mb-5 space-y-2 shadow-lg">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">¿Por qué instalar?</p>
          <Row icon={<ShieldCheck size={16} className="text-emerald-400" />} text="Tus datos no se borran automáticamente" />
          <Row icon={<Zap size={16} className="text-yellow-400" />} text="Carga más rápido, funciona sin internet" />
          <Row icon={<Smartphone size={16} className="text-blue-400" />} text="Acceso directo desde tu pantalla de inicio" />
        </div>

        {/* Install action */}
        <div className="w-full space-y-3">
          {canInstall ? (
            <button
              onClick={install}
              className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2 active:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
            >
              <Smartphone size={18} /> Instalar app
            </button>
          ) : isIOS ? (
            <IOSGuide />
          ) : isAndroid && isFirefox ? (
            <FirefoxAndroidGuide />
          ) : isAndroid && isSamsungBrowser ? (
            <SamsungGuide />
          ) : isAndroid ? (
            <ChromeAndroidGuide />
          ) : (
            <DesktopGuide />
          )}
        </div>

        {/* Escape hatch — botón secundario notorio */}
        <button
          onClick={onSkip}
          className="mt-6 w-full py-3.5 rounded-2xl bg-slate-800/80 border border-slate-600 text-slate-100 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] hover:bg-slate-700/80 hover:border-slate-500 transition-all"
        >
          Continuar sin instalar <span aria-hidden className="text-slate-400">→</span>
        </button>
        <p className="mt-2 text-[11px] text-slate-500 text-center">
          Podés usarla en el navegador, pero el navegador puede borrar tus datos.
        </p>

        {/* Credits */}
        <p className="mt-6 text-xs text-slate-600 text-center select-none">
          Planilla de Horas · by Nicolás Vázquez
        </p>
      </div>
    </div>
  )
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-300">
      <span className="shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

function StepBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 rounded-2xl p-4 text-sm text-slate-300 space-y-3">
      {children}
    </div>
  )
}

function IOSGuide() {
  return (
    <StepBox>
      <p className="font-semibold text-white flex items-center gap-2">
        <Smartphone size={15} className="text-blue-400" /> Agregar a pantalla de inicio (Safari)
      </p>
      <Step n={1}>
        Tocá el ícono de <strong className="text-white">Compartir</strong>{' '}
        <Share size={13} className="inline mb-0.5 text-blue-400" />{' '}
        en la barra inferior de Safari
      </Step>
      <Step n={2}>
        Deslizá hacia abajo y elegí{' '}
        <strong className="text-white">"Agregar a pantalla de inicio"</strong>
      </Step>
      <Step n={3}>
        Tocá <strong className="text-white">"Agregar"</strong> en la esquina superior derecha
      </Step>
      <div className="flex items-center gap-2 text-amber-300/80 pt-1 text-xs">
        <AlertTriangle size={13} className="shrink-0" />
        <span>Debés usar <strong>Safari</strong>. Chrome e Firefox en iOS no permiten instalar PWAs.</span>
      </div>
    </StepBox>
  )
}

function ChromeAndroidGuide() {
  return (
    <StepBox>
      <p className="font-semibold text-white flex items-center gap-2">
        <Smartphone size={15} className="text-blue-400" /> Instalar desde Chrome
      </p>
      <Step n={1}>
        Tocá el menú <MoreVertical size={13} className="inline text-blue-400" />{' '}
        (tres puntos arriba a la derecha)
      </Step>
      <Step n={2}>
        Elegí <strong className="text-white">"Instalar app"</strong> o{' '}
        <strong className="text-white">"Agregar a pantalla de inicio"</strong>
      </Step>
      <p className="text-xs text-slate-500 pt-1">
        Si no aparece, recargá la página un par de veces.
      </p>
    </StepBox>
  )
}

function FirefoxAndroidGuide() {
  return (
    <StepBox>
      <p className="font-semibold text-white flex items-center gap-2">
        <Smartphone size={15} className="text-blue-400" /> Instalar desde Firefox
      </p>
      <Step n={1}>
        Tocá el menú <MoreVertical size={13} className="inline text-blue-400" />{' '}
        (tres puntos abajo a la derecha)
      </Step>
      <Step n={2}>
        Tocá <strong className="text-white">"Instalar"</strong> o{' '}
        <strong className="text-white">Más → "Añadir a pantalla de inicio"</strong>
      </Step>
      <p className="text-xs text-slate-500 pt-1">
        Para mejor experiencia, usá Chrome en Android.
      </p>
    </StepBox>
  )
}

function SamsungGuide() {
  return (
    <StepBox>
      <p className="font-semibold text-white flex items-center gap-2">
        <Smartphone size={15} className="text-blue-400" /> Instalar desde Samsung Internet
      </p>
      <Step n={1}>
        Tocá el ícono de menú <strong className="text-white">☰</strong> (abajo a la derecha)
      </Step>
      <Step n={2}>
        Elegí <strong className="text-white">"Añadir página a"</strong> →{' '}
        <strong className="text-white">"Pantalla de inicio"</strong>
      </Step>
    </StepBox>
  )
}

function DesktopGuide() {
  return (
    <StepBox>
      <p className="font-semibold text-white flex items-center gap-2">
        <Monitor size={15} className="text-blue-400" /> Instalar en PC
      </p>
      <Step n={1}>
        Buscá el ícono <strong className="text-white">⊕</strong> en la barra de dirección de Chrome/Edge
      </Step>
      <Step n={2}>
        Hacé clic en <strong className="text-white">"Instalar"</strong> o{' '}
        <strong className="text-white">"Guardar e instalar"</strong>
      </Step>
      <p className="text-xs text-slate-500 pt-1">
        También: menú ⋮ → <strong className="text-slate-400">Instalar Planilla de Horas</strong>
      </p>
    </StepBox>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600/30 text-blue-300 text-xs flex items-center justify-center font-bold mt-0.5">
        {n}
      </span>
      <p className="text-slate-300 leading-snug">{children}</p>
    </div>
  )
}
