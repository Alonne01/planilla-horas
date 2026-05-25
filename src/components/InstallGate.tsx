import { usePWAInstall } from '../hooks/usePWAInstall'
import { Smartphone, Share, MoreVertical, Monitor } from 'lucide-react'

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
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 py-10">
      {/* Logo */}
      <img
        src="/icons/icon-512.svg"
        alt="Planilla de Horas"
        className="w-24 h-24 rounded-2xl mb-5 shadow-xl"
      />
      <h1 className="text-2xl font-bold text-white mb-1 text-center">Planilla de Horas</h1>
      <p className="text-slate-400 text-sm text-center mb-8 max-w-xs">
        Para usar la app y proteger tus datos, instalala en tu dispositivo.
      </p>

      {/* Why install */}
      <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-4 mb-6 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">¿Por qué instalar?</p>
        <Row icon="🔒" text="Tus datos no se borran automáticamente" />
        <Row icon="⚡" text="Carga más rápido, funciona sin internet" />
        <Row icon="📱" text="Acceso directo desde tu pantalla de inicio" />
      </div>

      {/* Install action */}
      <div className="w-full max-w-sm space-y-3">
        {canInstall ? (
          <button
            onClick={install}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2 active:bg-blue-700 transition-colors shadow-lg"
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

      {/* Escape hatch */}
      <button
        onClick={onSkip}
        className="mt-8 text-xs text-slate-600 hover:text-slate-400 transition-colors"
      >
        Continuar sin instalar →
      </button>
    </div>
  )
}

function Row({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-300">
      <span className="text-base">{icon}</span>
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
      <p className="text-xs text-amber-300/80 pt-1">
        ⚠️ Debés usar <strong>Safari</strong>. Chrome e Firefox en iOS no permiten instalar PWAs.
      </p>
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
        Buscá el ícono <strong className="text-white">⊕</strong> o{' '}
        <strong className="text-white">💻</strong> en la barra de dirección de Chrome/Edge
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
