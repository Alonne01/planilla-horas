import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { APP_VERSION } from './version'

declare const __BUILD_TIME__: string
console.info(`[Planilla] v${APP_VERSION}`, 'build', __BUILD_TIME__)

// Auto-actualización (modo autoUpdate): el registro lo auto-inyecta vite-plugin-pwa y el SW nuevo se
// activa solo. Acá chequeamos seguido si hay versión nueva (clave en móvil: al volver al frente / foco /
// restaurar de bfcache); App.tsx recarga con el toast cuando el SW nuevo toma el control.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(reg => {
    const check = () => { reg.update().catch(() => {}) }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    setInterval(check, 15 * 60 * 1000)
    check()
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
