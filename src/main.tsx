import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-actualización del PWA SIN que el usuario tenga que recargar.
if ('serviceWorker' in navigator) {
  // 1) Recargar cuando un SW nuevo toma el control (nueva versión). Sólo en ACTUALIZACIONES:
  //    si la página ya estaba controlada por un SW (no en la 1ª instalación, que reloadea de gusto).
  if (navigator.serviceWorker.controller) {
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
  }
  // 2) Buscar versiones nuevas al volver a la app y cada 30 min (apps/pestañas abiertas mucho tiempo).
  //    Si hay una nueva, el SW se activa (skipWaiting/clientsClaim) → dispara el reload de arriba.
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
