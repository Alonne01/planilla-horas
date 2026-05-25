import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Reload the page when a new service worker takes control (auto-update).
// Guard: skip the very first controllerchange on first install — clientsClaim()
// fires it when controller goes null→SW, which isn't an "update" reload.
// After that first skip, future updates will reload normally.
if ('serviceWorker' in navigator) {
  let skipFirst = !navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    if (skipFirst) { skipFirst = false; return }
    reloading = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
