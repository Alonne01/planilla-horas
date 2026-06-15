import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

declare const __BUILD_TIME__: string
console.info('[Planilla] build', __BUILD_TIME__)

// Auto-actualización del PWA: detecta versiones nuevas y avisa a la UI (App muestra un toast y recarga).
// Detección por `updatefound` → estado 'installed' (robusto: no depende de `controllerchange` ni del
// `controller` al cargar, que en cold-start de PWA suele estar null y se perdía el aviso).
if ('serviceWorker' in navigator) {
  let avisado = false
  const notify = () => { if (!avisado) { avisado = true; window.dispatchEvent(new Event('sw-updated')) } }
  navigator.serviceWorker.ready.then(reg => {
    // Ya hay una versión nueva instalada/esperando al cargar (y ya había un SW = es update, no 1ª vez).
    if (reg.waiting && navigator.serviceWorker.controller) notify()
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing
      if (!sw) return
      sw.addEventListener('statechange', () => {
        // 'installed' habiendo ya un controller = hay una actualización lista (no la 1ª instalación).
        if (sw.state === 'installed' && navigator.serviceWorker.controller) notify()
      })
    })
    // Buscar versiones nuevas al volver a la app y cada 30 min.
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
