import Dexie, { type Table } from 'dexie'

const SHADOW_KEY = 'planilla-shadow'
const LAST_BACKUP_KEY = 'planilla-last-backup-ts'

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
  observaciones: string
  proyecto: string
  esFeriado: boolean
  esFeriadoTrabajado: boolean
  esFrancoCompensatorio: boolean
  esFrancoTrabajado: boolean
  esAusenciaJustificada: boolean
  fechaCreacion: number
}

export interface AppSettings {
  id: 1  // singleton row
  nombreUsuario: string
  diagrama: 'LUNES_VIERNES' | 'D10X5' | 'D7X7' | 'D10X4'
  diagramaInicioMs: number
  proyectosFrecuentes: string[]  // JSON array
  // Hidden salary fields (enabled via VITE_SHOW_SALARY)
  sueldoBasico: number
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  nombreUsuario: '',
  diagrama: 'LUNES_VIERNES',
  diagramaInicioMs: 0,
  proyectosFrecuentes: [],
  sueldoBasico: 2057223.77,
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
  return s
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
