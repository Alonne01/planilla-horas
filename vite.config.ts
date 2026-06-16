import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/planilla-horas/',
  // Sello de build: hace que cada compilación sea única → el service worker siempre detecta la
  // versión nueva (y sirve de marcador de versión en consola).
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate', // el SW nuevo se activa solo (skipWaiting+clientsClaim) → updates confiables en móvil/PWA
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Planilla de Horas',
        short_name: 'Planilla',
        description: 'Registro de horas trabajadas',
        theme_color: '#08af9e',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,xlsx}'],
        // Agrega el handler de recordatorio (periodicsync + notificationclick) al SW generado.
        importScripts: ['sw-recordatorio.js'],
        runtimeCaching: [],
      },
    }),
  ],
})
