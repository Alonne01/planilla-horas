import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

declare const __BUILD_TIME__: string
console.info('[Planilla] build', __BUILD_TIME__)

// Auto-actualización del PWA: detecta versiones nuevas y avisa a la UI (App muestra un toast y recarga).
if ('serviceWorker' in navigator) {
  // 1) Cuando un SW nuevo toma el control, avisar a la UI — sólo en ACTUALIZACIONES, no en la 1ª
  //    instalación. App muestra el toast ~3 s y después recarga.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.dispatchEvent(new Event('sw-updated'))
    }, { once: true })
  }
  // 2) Buscar versiones nuevas al volver a la app y cada 30 min (apps/pestañas abiertas mucho tiempo).
  navigator.serviceWorker.ready.then(reg => {
    const check = () => { reg.update().catch(() => {}) }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
    setInterval(check, 30 * 60 * 1000)
    check()
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
