// Recordatorio de fin de período: avisa ~1 día antes del cierre que hay que cargar y ENVIAR la planilla.
//
// Dos canales (el cierre es el MISMO para todos, no depende del diagrama del usuario):
//   1. Aviso EN-APP al abrir la app (todas las plataformas) — banner `RecordatorioToast`.
//   2. Notificación con la app CERRADA vía Periodic Background Sync (Android instalado). En iOS no hay
//      forma client-only de notificar con la app cerrada (haría falta push con servidor), así que ahí
//      sólo queda el aviso en-app.
//
// La "agenda" (próximo cierre + ventana) se guarda en Cache Storage para que el service worker la lea
// sin depender de IndexedDB. El SW (`public/sw-recordatorio.js`) dispara la notificación.

import { defaultPeriodoMes, defaultPeriodoAnio, periodoEnd, MESES_ES } from './diagrama'

const SYNC_TAG = 'recordatorio-cierre'
const AGENDA_CACHE = 'planilla-recordatorio'
// Clave bajo el base path del sitio para que cliente y SW (ambos bajo /planilla-horas/) la compartan.
const AGENDA_KEY = '/planilla-horas/__recordatorio-agenda'
const DESCARTADO_KEY = 'planilla-recordatorio-descartado' // cierreMs del aviso en-app ya descartado
const HABILITADO_KEY = 'planilla-recordatorio-habilitado' // '0' = el usuario lo desactivó (default: activado)
const HORA_AVISO = 9 // empieza a avisar el día anterior a las 09:00

export interface AgendaRecordatorio {
  cierreMs: number            // medianoche del día de cierre del período vigente
  desdeMs: number             // desde cuándo avisar (día anterior 09:00)
  hastaMs: number             // hasta cuándo (fin del día de cierre)
  notificadoCierreMs: number  // último cierre para el que el SW YA disparó la notificación (dedupe)
  habilitado: boolean         // el usuario tiene el recordatorio activado (default true); el SW lo respeta
}

interface RegistrationConPeriodicSync extends ServiceWorkerRegistration {
  periodicSync?: {
    register(tag: string, opts?: { minInterval?: number }): Promise<void>
    unregister(tag: string): Promise<void>
  }
}

/** ¿El recordatorio está habilitado? Viene ACTIVADO por defecto; el usuario lo puede apagar. */
export function recordatorioHabilitado(): boolean {
  try { return localStorage.getItem(HABILITADO_KEY) !== '0' } catch { return true }
}
export function setRecordatorioHabilitado(habilitado: boolean): void {
  try { localStorage.setItem(HABILITADO_KEY, habilitado ? '1' : '0') } catch { /* ignore */ }
}

/** Día/mes (es-AR) del cierre, para el texto del aviso. */
export function textoCierre(cierreMs: number): { dia: number; mes: string } {
  const d = new Date(cierreMs)
  return { dia: d.getDate(), mes: MESES_ES[d.getMonth()] }
}

/** Cierre del período vigente (medianoche del día de cierre) + ventana del recordatorio. */
export function calcularAgenda(): AgendaRecordatorio {
  const cierre = periodoEnd(defaultPeriodoMes(), defaultPeriodoAnio()) // medianoche del día de cierre
  const desde = new Date(cierre.getFullYear(), cierre.getMonth(), cierre.getDate() - 1, HORA_AVISO, 0, 0)
  const hasta = new Date(cierre.getFullYear(), cierre.getMonth(), cierre.getDate() + 1, 0, 0, 0) // fin del día de cierre
  return { cierreMs: cierre.getTime(), desdeMs: desde.getTime(), hastaMs: hasta.getTime(), notificadoCierreMs: 0, habilitado: recordatorioHabilitado() }
}

async function leerAgenda(): Promise<AgendaRecordatorio | null> {
  try {
    const cache = await caches.open(AGENDA_CACHE)
    const res = await cache.match(AGENDA_KEY)
    return res ? (await res.json() as AgendaRecordatorio) : null
  } catch { return null }
}

async function escribirAgenda(a: AgendaRecordatorio): Promise<void> {
  try {
    const cache = await caches.open(AGENDA_CACHE)
    await cache.put(AGENDA_KEY, new Response(JSON.stringify(a), { headers: { 'content-type': 'application/json' } }))
  } catch { /* Cache Storage no disponible */ }
}

/** Recalcula la agenda y la guarda (preservando el dedupe si el cierre no cambió). Llamar al abrir. */
export async function actualizarAgenda(): Promise<AgendaRecordatorio> {
  const nueva = calcularAgenda()
  const previa = await leerAgenda()
  if (previa && previa.cierreMs === nueva.cierreMs) nueva.notificadoCierreMs = previa.notificadoCierreMs
  await escribirAgenda(nueva)
  return nueva
}

/** ¿Estamos en la ventana del recordatorio (día anterior 09:00 → fin del día de cierre)? */
export function enVentana(a: AgendaRecordatorio, now = Date.now()): boolean {
  return now >= a.desdeMs && now < a.hastaMs
}

export function recordatorioDescartado(cierreMs: number): boolean {
  try { return localStorage.getItem(DESCARTADO_KEY) === String(cierreMs) } catch { return false }
}
export function descartarRecordatorio(cierreMs: number): void {
  try { localStorage.setItem(DESCARTADO_KEY, String(cierreMs)) } catch { /* ignore */ }
}

export function notificacionesSoportadas(): boolean {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator
}
export function notificacionesConcedidas(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** Registra el Periodic Background Sync (best-effort; sólo Android instalado con suficiente engagement;
 *  en iOS u otros simplemente no hace nada y queda el aviso en-app). */
export async function registrarSyncPeriodico(): Promise<void> {
  try {
    const reg = (await navigator.serviceWorker.ready) as RegistrationConPeriodicSync
    if (!reg.periodicSync) return
    const estado = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName })
    if (estado.state !== 'granted') return
    await reg.periodicSync.register(SYNC_TAG, { minInterval: 24 * 60 * 60 * 1000 })
  } catch { /* no soportado o sin permiso */ }
}

/** Pide permiso de notificaciones (requiere gesto del usuario) y registra el sync periódico.
 *  Devuelve true si quedaron activas las notificaciones. */
export async function activarRecordatorios(): Promise<boolean> {
  setRecordatorioHabilitado(true) // activar las notificaciones implica tener el recordatorio prendido
  if (!notificacionesSoportadas()) return false
  let permiso = Notification.permission
  if (permiso === 'default') {
    try { permiso = await Notification.requestPermission() } catch { return false }
  }
  if (permiso !== 'granted') return false
  await actualizarAgenda()
  await registrarSyncPeriodico()
  return true
}

/** Apaga el recordatorio: marca la preferencia en off, reescribe la agenda (el SW deja de notificar)
 *  y desregistra el sync periódico. El aviso en-app tampoco se mostrará. */
export async function desactivarRecordatorios(): Promise<void> {
  setRecordatorioHabilitado(false)
  await actualizarAgenda() // agenda con habilitado=false → el SW no dispara
  try {
    const reg = (await navigator.serviceWorker.ready) as RegistrationConPeriodicSync
    if (reg.periodicSync?.unregister) await reg.periodicSync.unregister('recordatorio-cierre')
  } catch { /* ignore */ }
}
