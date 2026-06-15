import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

declare const __BUILD_TIME__: string
console.info('[Planilla] build', __BUILD_TIME__)

// El registro del service worker + la detección de actualizaciones se manejan en App.tsx
// (registerSW de vite-plugin-pwa, modo prompt) para mostrar el toast y aplicar la nueva versión.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
