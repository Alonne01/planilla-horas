import Dexie, { type Table } from 'dexie'
import type { LineaTrabajo } from '../lib/calculo-horas'
import { PRUEBA_CUTOFF_MS } from '../lib/diagrama'

const SHADOW_KEY = 'planilla-shadow'
const LAST_BACKUP_KEY = 'planilla-last-backup-ts'
const AUTO_BACKUP_KEY = 'planilla-auto-backup-ts'

/** Returns ms since last auto-backup trigger, or Infinity if never */
export function msSinceAutoBackup(): number {
  const ts = localStorage.getItem(AUTO_BACKUP_KEY)
  return ts ? Date.now() - parseInt(ts, 10) : Infinity
}

/** Mark that an auto-backup was just triggered */
export function markAutoBackupDone(): void {
  localStorage.setItem(AUTO_BACKUP_KEY, String(Date.now()))
}

const CLOUD_BACKUP_KEY = 'planilla-cloud-backup-ts'

/** Returns ms since last successful CLOUD backup, or Infinity if never */
export function msSinceCloudBackup(): number {
  const ts = localStorage.getItem(CLOUD_BACKUP_KEY)
  return ts ? Date.now() - parseInt(ts, 10) : Infinity
}

/** Mark that a cloud backup was just uploaded successfully */
export function markCloudBackupDone(): void {
  localStorage.setItem(CLOUD_BACKUP_KEY, String(Date.now()))
}

export interface RegistroHoras {
  id: string
  fechaMs: number
  entradaInicioMs: number | null
  salidaInicioMs: number | null
  entradaFinMs: number | null
  salidaFinMs: number | null
  lugarTrabajo: 'Base' | 'Campo' | 'Franco'
  pernocte: 'NO' | 'Hotel' | 'Trailer'
  maneja: boolean
  horasViaje: number
  kmViaje?: number  // km informativos del viaje (sólo opción "Otro"); NO afecta el cálculo (sólo cuenta horasViaje)
  observaciones: string
  proyecto: string
  esFeriado: boolean
  esFeriadoTrabajado: boolean
  esFrancoCompensatorio: boolean
  esFrancoTrabajado: boolean
  esAusenciaJustificada: boolean
  esFaltaInjustificada: boolean  // inasistencia injustificada → descuenta básico proporcional + presentismo
  esVacaciones?: boolean  // licencia por vacaciones (paga, no se trabaja; no descuenta ni pierde presentismo)
  fechaCreacion: number
}

export interface AppSettings {
  id: 1  // singleton row
  nombreUsuario: string
  diagrama: 'LUNES_VIERNES' | 'D10X5' | 'D7X7' | 'D10X4'
  diagramaInicioMs: number
  lineaTrabajo: LineaTrabajo  // afecta el conteo de horas (SBDP suma 12 h al 50% en Campo)
  proyectosFrecuentes: string[]  // JSON array
  // Hidden salary fields (enabled via VITE_SHOW_SALARY)
  sueldoBasico: number
  sueldoBasicoVigenciaMs: number  // mes/fecha al que corresponde el básico cargado (para escalar por paritaria)
  convenio: 'CCT_637_11' | 'CCT_644_12'
  fechaIngresoMs: number
  tipoTurno: 'NINGUNO' | 'TURNO_A' | 'TURNO_B' | 'TURNO_S'
  zonaVacaMuerta: boolean
  tasaDesarraigo644: number
  tieneGuardiaPasiva: boolean
  valorGuardiaDia: number
  adicionalCampoRate: number
  bonoPazRate644: number
  solidaria644: number
  // Respaldo en la nube (Firestore): identidad = nombre del empleado (nombreUsuario) + código de
  // 6 dígitos. El "candado" bloquea el código para evitar cambios accidentales.
  backupCodigo: string
  backupBloqueado: boolean
  // Saldo NETO de francos compensatorios (ganados − usados) arrastrado de los registros que se
  // podaron por antigüedad (>6 meses). Sin esto, podar los meses viejos perdería los francos
  // ganados y no usados. El contador real = este saldo + (ganados − usados en los registros vivos).
  francosCompSaldoBase: number
  // Al cerrar la carga de un día con cambios sin guardar: si está activo, guarda siempre sin
  // preguntar; si no, muestra el diálogo "Guardar / Descartar" (con la opción de activarlo).
  guardarSiempreAlSalir: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  nombreUsuario: '',
  diagrama: 'LUNES_VIERNES',
  diagramaInicioMs: 0,
  lineaTrabajo: 'SURFACE_WELL_TESTING',
  proyectosFrecuentes: [],
  // 0 = sin configurar (cada usuario carga el suyo). Antes era el básico de un empleado puntual, lo que
  // hacía que un usuario nuevo viera la proyección con un básico ajeno.
  sueldoBasico: 0,
  sueldoBasicoVigenciaMs: 0,
  convenio: 'CCT_637_11',
  fechaIngresoMs: 0,
  tipoTurno: 'NINGUNO',
  zonaVacaMuerta: false,
  tasaDesarraigo644: 0.20,
  tieneGuardiaPasiva: false,
  valorGuardiaDia: 0,
  adicionalCampoRate: 0.30,
  bonoPazRate644: 0.1438,
  solidaria644: 0.022,
  backupCodigo: '',
  backupBloqueado: false,
  francosCompSaldoBase: 0,
  guardarSiempreAlSalir: false,
}

class PlanillaDB extends Dexie {
  registros!: Table<RegistroHoras>
  settings!: Table<AppSettings>

  constructor() {
    super('PlanillaHorasDB')
    this.version(1).stores({
      registros: 'id, fechaMs',
      settings: 'id',
    })
  }
}

export const db = new PlanillaDB()

/** Write a full snapshot to localStorage as secondary safety copy */
export async function shadowBackup(): Promise<void> {
  try {
    const [registros, settings] = await Promise.all([
      db.registros.toArray(),
      db.settings.toArray(),
    ])
    localStorage.setItem(SHADOW_KEY, JSON.stringify({ version: 1, registros, settings, ts: Date.now() }))
  } catch {
    // localStorage full or unavailable — non-fatal
  }
}

/**
 * On startup: if IndexedDB has no records but localStorage has a shadow copy,
 * silently restore the data. Returns true if a recovery was performed.
 */
export async function restoreFromShadow(): Promise<boolean> {
  try {
    const raw = localStorage.getItem(SHADOW_KEY)
    if (!raw) return false

    const data = JSON.parse(raw)
    if (!Array.isArray(data.registros) || data.registros.length === 0) return false

    // Check + restore inside one transaction to avoid race conditions
    let restored = false
    await db.transaction('rw', db.registros, db.settings, async () => {
      const count = await db.registros.count()
      if (count > 0) return
      await db.registros.bulkPut(data.registros)
      if (Array.isArray(data.settings) && data.settings.length) {
        await db.settings.bulkPut(data.settings)
      }
      restored = true
    })
    return restored
  } catch {
    return false
  }
}

/** Returns ms since last manual backup export, or Infinity if never */
export function msSinceLastBackup(): number {
  const ts = localStorage.getItem(LAST_BACKUP_KEY)
  return ts ? Date.now() - parseInt(ts, 10) : Infinity
}

/** Mark that a manual backup was just exported */
export function markBackupDone(): void {
  localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
}

/** Request persistent storage so the OS doesn't evict the DB */
export async function requestPersistentStorage(): Promise<void> {
  if (navigator.storage?.persist) {
    const granted = await navigator.storage.persist()
    if (!granted) console.warn('Persistent storage not granted')
  }
}

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get(1)
  if (!s) {
    await db.settings.put(DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }
  // Mezclar defaults para que los campos nuevos (ej. lineaTrabajo) tengan valor en
  // configuraciones guardadas antes de que existieran.
  return { ...DEFAULT_SETTINGS, ...s }
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<void> {
  const current = await getSettings()
  await db.settings.put({ ...current, ...partial, id: 1 })
  await shadowBackup()
}

/** Export all data as JSON string for backup */
export async function exportBackupJSON(): Promise<string> {
  const [registros, settings] = await Promise.all([
    db.registros.toArray(),
    db.settings.toArray(),
  ])
  return JSON.stringify({ version: 1, registros, settings }, null, 2)
}

/** Import backup JSON — replaces all data */
export async function importBackupJSON(json: string): Promise<void> {
  const data = JSON.parse(json)
  if (!data.registros || !Array.isArray(data.registros)) throw new Error('Invalid backup format')
  await db.transaction('rw', db.registros, db.settings, async () => {
    await db.registros.clear()
    await db.registros.bulkPut(data.registros)
    if (data.settings?.length) {
      await db.settings.clear()
      await db.settings.bulkPut(data.settings)
    }
  })
  await shadowBackup()
}

/** Delete all hour records and sync shadow backup. Settings are preserved.
 *  Borrado MANUAL y total → es un reinicio: también se descarta el saldo arrastrado de francos. */
export async function clearAllRegistros(): Promise<void> {
  await db.registros.clear()
  const s = await db.settings.get(1)
  if (s && s.francosCompSaldoBase !== 0) {
    await db.settings.put({ ...DEFAULT_SETTINGS, ...s, id: 1, francosCompSaldoBase: 0 })
  }
  await shadowBackup()
}

/** Borra los registros del período de prueba del tutorial (sentinela lejano). Devuelve cuántos. */
export async function clearPeriodoPrueba(): Promise<number> {
  const deleted = await db.registros.where('fechaMs').aboveOrEqual(PRUEBA_CUTOFF_MS).delete()
  if (deleted > 0) await shadowBackup()
  return deleted
}

/**
 * Delete records older than 6 months. Returns count of deleted records.
 *
 * Antes de borrar, conserva el saldo NETO de francos compensatorios de esos registros
 * (ganados por franco trabajado − usados) sumándolo a `settings.francosCompSaldoBase`.
 * Así, podar los meses viejos no hace desaparecer los francos ganados y todavía no usados.
 */
export async function pruneOldRegistros(): Promise<number> {
  const now = new Date()
  const cutoffMs = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime()
  let deleted = 0
  await db.transaction('rw', db.registros, db.settings, async () => {
    const viejos = await db.registros.where('fechaMs').below(cutoffMs).toArray()
    if (viejos.length === 0) return
    const ganados = viejos.filter(r => r.esFrancoTrabajado).length
    const usados = viejos.filter(r => r.esFrancoCompensatorio).length
    const neto = ganados - usados
    if (neto !== 0) {
      const s = await db.settings.get(1)
      const base = ((s?.francosCompSaldoBase) ?? 0) + neto
      await db.settings.put({ ...DEFAULT_SETTINGS, ...s, id: 1, francosCompSaldoBase: base })
    }
    deleted = await db.registros.where('fechaMs').below(cutoffMs).delete()
  })
  if (deleted > 0) await shadowBackup()
  return deleted
}

/**
 * One-time migration: the old Campo toggle stored horasViaje=1 (boolean),
 * the new code stores actual hours (Campo: 3/5/manual, o el 2 legado).
 * Upgrade any such record with exactly 1 → 2.
 *
 * OJO: el toggle "Viaje a base (+1h)" guarda horasViaje=1 en días de Base, así que
 * NO hay que tocar los registros de Base o se rompería esa +1h en cada arranque.
 */
export async function migrateHorasViaje(): Promise<number> {
  const toMigrate = await db.registros.filter(r => r.horasViaje === 1 && r.lugarTrabajo !== 'Base').toArray()
  if (toMigrate.length === 0) return 0
  await db.registros.bulkPut(toMigrate.map(r => ({ ...r, horasViaje: 2 })))
  await shadowBackup()
  return toMigrate.length
}
