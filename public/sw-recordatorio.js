/* eslint-disable */
// Recordatorio de fin de período (Periodic Background Sync). Se importa desde el SW que genera Workbox
// (vite.config → workbox.importScripts). Lee la "agenda" que la app dejó en Cache Storage y, si estamos
// en la ventana del recordatorio y todavía no se notificó para este cierre, muestra la notificación
// aunque la app esté CERRADA (Android instalado con engagement suficiente).
//
// El cierre es el MISMO para todos los usuarios (no depende del diagrama), así que alcanza con la
// agenda que escribe la app al abrir (src/lib/recordatorio.ts) — el SW no toca IndexedDB.

const RECORDATORIO_CACHE = 'planilla-recordatorio'
const RECORDATORIO_KEY = '/planilla-horas/__recordatorio-agenda'

async function leerAgendaSW() {
  try {
    const cache = await caches.open(RECORDATORIO_CACHE)
    const res = await cache.match(RECORDATORIO_KEY)
    return res ? await res.json() : null
  } catch (e) { return null }
}

async function guardarAgendaSW(a) {
  try {
    const cache = await caches.open(RECORDATORIO_CACHE)
    await cache.put(RECORDATORIO_KEY, new Response(JSON.stringify(a), { headers: { 'content-type': 'application/json' } }))
  } catch (e) { /* ignore */ }
}

async function dispararRecordatorio() {
  const a = await leerAgendaSW()
  if (!a) return
  const now = Date.now()
  if (now < a.desdeMs || now >= a.hastaMs) return   // fuera de la ventana
  if (a.notificadoCierreMs === a.cierreMs) return    // ya se notificó para este cierre
  const dia = new Date(a.cierreMs).getDate()
  await self.registration.showNotification('Cierre de la planilla', {
    body: `El período cierra el ${dia}. No te olvides de cargar y enviar tu planilla.`,
    icon: '/planilla-horas/icons/icon-192.png',
    badge: '/planilla-horas/icons/icon-192.png',
    tag: 'recordatorio-cierre',
    renotify: true,
    data: { url: '/planilla-horas/' },
  })
  a.notificadoCierreMs = a.cierreMs
  await guardarAgendaSW(a)
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'recordatorio-cierre') event.waitUntil(dispararRecordatorio())
})

// Al tocar la notificación: enfocar la pestaña abierta o abrir la app.
self.addEventListener('notificationclick', (event) => {
  if (event.notification.tag !== 'recordatorio-cierre') return
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/planilla-horas/'
  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of clientes) {
      if (c.url.includes('/planilla-horas') && 'focus' in c) return c.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})
