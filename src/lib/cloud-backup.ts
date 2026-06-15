// Respaldo en la nube (Firebase Firestore) CIFRADO, direccionado por usuario + código de 6 dígitos.
//
// El usuario+código nunca viajan en claro: el id del documento es base64url(SHA-256("usuario:codigo"))
// y el contenido va cifrado con AES-GCM (clave derivada del código vía PBKDF2). Sin el código no se
// puede ni calcular el id ni descifrar el contenido. Espeja el enfoque PBKDF2 de EquipTrack
// (util/BackupPinManager.kt). La privacidad la completan las reglas Firestore (get sí, list/delete no).
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, increment, type Firestore } from 'firebase/firestore/lite'
import { exportBackupJSON, importBackupJSON } from '../db/database'
import { APP_VERSION } from '../version'
import { leerMetricas } from './metricas'

// Config web PÚBLICA (no es secreta: viaja en el bundle; la seguridad la dan las reglas Firestore).
const firebaseConfig = {
  apiKey: 'AIzaSyCuR0lmbieDncR00XVA2GSQwAjflFIKki0',
  authDomain: 'planillas-backups-986dd.firebaseapp.com',
  projectId: 'planillas-backups-986dd',
  storageBucket: 'planillas-backups-986dd.firebasestorage.app',
  messagingSenderId: '479377881165',
  appId: '1:479377881165:web:e4da9fbdf25c6b374ac404',
}

const COLLECTION = 'backups'
// Padrón EN CLARO (sólo nombre + línea + última actividad, SIN datos sensibles ni cifrados): permite
// al admin contar usuarios y líneas. Va aparte de `backups` para no exponer los blobs cifrados al listar.
const PADRON = 'padron'
const PBKDF2_ITERATIONS = 100_000

// ── Tope diario de operaciones de nube POR DISPOSITIVO ──────────────────────────
// Firestore (plan gratis) comparte la cuota diaria de lecturas/escrituras entre TODOS los usuarios
// del proyecto. El uso normal (auto cada 3 días + algún respaldo/restore manual) queda muy por
// debajo; este tope corta el spam para no agotar la cuota.
const OPS_KEY = 'planilla-cloud-ops'
const MAX_OPS_DIA = 10

function hoyKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function opsHoy(): number {
  try {
    const [dia, n] = (localStorage.getItem(OPS_KEY) ?? '').split('|')
    return dia === hoyKey() ? (parseInt(n, 10) || 0) : 0
  } catch { return 0 }
}
// Dispositivo admin: el que desbloqueó la pantalla de admin (Nicolas Vazquez + 000000 + 3 toques al
// caracol). NO tiene tope diario de nube — puede listar el padrón y respaldar/restaurar sin límite.
const ADMIN_KEY = 'planilla-admin-unlocked'
/** ¿Este dispositivo desbloqueó el modo admin? (sin tope diario de nube). */
export function esAdminDispositivo(): boolean {
  try { return localStorage.getItem(ADMIN_KEY) === '1' } catch { return false }
}
/** Marca este dispositivo como admin (lo llama App.tsx al validar el gesto del caracol). */
export function marcarAdminDispositivo(): void {
  try { localStorage.setItem(ADMIN_KEY, '1') } catch { /* ignore */ }
}

/** ¿Quedan operaciones de nube disponibles hoy en este dispositivo? (anti-abuso de cuota).
 *  El dispositivo admin no tiene tope. */
export function quedanOperacionesNube(): boolean {
  return esAdminDispositivo() || opsHoy() < MAX_OPS_DIA
}

// ── Uso GLOBAL de Firebase (todos los usuarios) ─────────────────────────────────
// La cuota gratis (Spark) no es consultable desde el cliente, así que la estimamos con un contador
// compartido en Firestore: colección `uso`, un doc por día EN HORA DEL PACÍFICO (cuando Firebase
// resetea la cuota). Cada operación suma sus lecturas/escrituras; el admin lo lee para el medidor.
const USO = 'uso'
const QUOTA_READS = 50_000   // lecturas/día (plan Spark)
const QUOTA_WRITES = 20_000  // escrituras/día (plan Spark)

/** Fecha (zona Pacífico, donde resetea la cuota de Firebase) + segundos transcurridos de ese día. */
function usoPacifico(): { key: string; segDelDia: number } {
  const now = new Date()
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now)
  const get = (ty: string) => parseInt(t.find(p => p.type === ty)?.value ?? '0', 10)
  return { key, segDelDia: get('hour') * 3600 + get('minute') * 60 + get('second') }
}

/** Suma lecturas/escrituras al contador global del día (best-effort, no debe romper la operación). */
function contarUso(reads: number, writes: number): void {
  if (reads === 0 && writes === 0) return
  // El propio incremento es 1 escritura más → la sumo para no subestimar la cuota de writes.
  setDoc(
    doc(getDb(), USO, usoPacifico().key),
    { reads: increment(reads), writes: increment(writes + 1), updatedAt: Date.now() },
    { merge: true },
  ).catch(() => { /* contador secundario: si falla (reglas/red) no afecta la operación */ })
}

export interface UsoFirebase {
  reads: number
  writes: number
  quotaReads: number
  quotaWrites: number
  resetEnMs: number
}
/** Lee el contador GLOBAL de uso de Firebase de hoy (Pacífico) para el medidor de admin. */
export async function leerUsoFirebase(): Promise<UsoFirebase> {
  const { key, segDelDia } = usoPacifico()
  const snap = await getDoc(doc(getDb(), USO, key))
  contarUso(1, 0) // esta lectura también cuenta
  const d = (snap.exists() ? snap.data() : {}) as { reads?: unknown; writes?: unknown }
  return {
    reads: typeof d.reads === 'number' ? d.reads : 0,
    writes: typeof d.writes === 'number' ? d.writes : 0,
    quotaReads: QUOTA_READS,
    quotaWrites: QUOTA_WRITES,
    resetEnMs: (86_400 - segDelDia) * 1000,
  }
}

/** Cuenta una operación de nube (lectura o escritura) contra el tope diario POR DISPOSITIVO. */
function registrarOperacionNube(): void {
  try { localStorage.setItem(OPS_KEY, `${hoyKey()}|${opsHoy() + 1}`) } catch { /* ignore */ }
}

let _db: Firestore | null = null
function getDb(): Firestore {
  if (!_db) {
    const app: FirebaseApp = initializeApp(firebaseConfig)
    _db = getFirestore(app)
  }
  return _db
}

/** Usuario no vacío + código de exactamente 6 dígitos. */
export function credencialesNubeValidas(usuario: string, codigo: string): boolean {
  return usuario.trim().length > 0 && /^\d{6}$/.test(codigo.trim())
}

// ── Helpers base64 ───────────────────────────────────────────────────────────
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
function bufToB64Url(buf: ArrayBuffer): string {
  return bufToB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Password estable para id y clave: usuario normalizado (trim + minúsculas) + ":" + código (trim).
function credKey(usuario: string, codigo: string): string {
  return `${usuario.trim().toLowerCase()}:${codigo.trim()}`
}

async function computeDocId(usuario: string, codigo: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credKey(usuario, codigo)))
  return bufToB64Url(hash)
}

async function deriveKey(usuario: string, codigo: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(credKey(usuario, codigo)), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

interface BackupDoc {
  iv: string
  salt: string
  data: string
  updatedAt: number
  schema: number
  /** Nombre del usuario EN CLARO: sólo para identificar cada backup en la consola de Firebase.
   *  Los datos siguen cifrados y el código sigue siendo secreto. */
  usuario?: string
  /** Línea de trabajo EN CLARO (etiqueta legible): para identificar el backup en la consola. */
  linea?: string
}

/** Entrada del padrón (datos NO sensibles): para el conteo de usuarios y líneas en la pantalla admin. */
export interface PadronEntry {
  nombre: string
  linea: string
  updatedAt: number
  version?: string
  /** Toques al botón de donación (acumulado por dispositivo). */
  donaciones?: number
  /** Veces que apareció el "¡Gracias!" tras donar (acumulado por dispositivo). */
  gracias?: number
  /** Veces que exportó la planilla a Excel (acumulado por dispositivo). */
  exportaciones?: number
}

/**
 * Cifra todo el respaldo (exportBackupJSON) y lo sube a Firestore. Lanza si falla la red.
 * `linea` (etiqueta legible) se guarda EN CLARO junto al nombre para identificar el backup en la
 * consola y para el padrón de admin; los datos del respaldo siguen cifrados y el código secreto.
 */
export async function subirBackupNube(usuario: string, codigo: string, linea?: string): Promise<void> {
  const json = await exportBackupJSON()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(usuario, codigo, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json))
  const lineaTxt = linea?.trim() ?? ''
  const docId = await computeDocId(usuario, codigo)
  const payload: BackupDoc = {
    iv: bufToB64(iv.buffer),
    salt: bufToB64(salt.buffer),
    data: bufToB64(ct),
    updatedAt: Date.now(),
    schema: 1,
    usuario: usuario.trim(), // en claro, sólo para identificar el backup en la consola
  }
  if (lineaTxt) payload.linea = lineaTxt // Firestore no acepta undefined: sólo se incluye si hay valor
  await setDoc(doc(getDb(), COLLECTION, docId), payload)
  // Padrón: doc gemelo SIN datos sensibles para el conteo de admin (best-effort, no debe romper el backup).
  try {
    const { donaciones, gracias, exportaciones } = leerMetricas()
    const entry: PadronEntry = {
      nombre: usuario.trim(), linea: lineaTxt, updatedAt: Date.now(), version: APP_VERSION, donaciones, gracias, exportaciones,
    }
    await setDoc(doc(getDb(), PADRON, docId), entry)
  } catch { /* el padrón es secundario: si falla, el respaldo igual quedó subido */ }
  registrarOperacionNube()
  contarUso(0, 2) // backup + padrón (escrituras)
}

/**
 * Lista el padrón (nombre + línea + última actividad de cada usuario) para la pantalla de admin.
 * Requiere reglas Firestore que permitan list/read en la colección `padron`. Lanza ante error de red
 * o permisos. Cuenta como una operación de nube (anti-abuso de cuota).
 */
export async function listarPadronNube(): Promise<PadronEntry[]> {
  const snap = await getDocs(collection(getDb(), PADRON))
  registrarOperacionNube()
  contarUso(Math.max(1, snap.docs.length), 0) // 1 lectura por doc (mín. 1)
  return snap.docs.map(d => {
    const x = d.data() as Partial<PadronEntry>
    return {
      nombre: String(x.nombre ?? '').trim(),
      linea: String(x.linea ?? '').trim(),
      updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : 0,
      version: x.version != null ? String(x.version) : undefined,
      donaciones: typeof x.donaciones === 'number' ? x.donaciones : 0,
      gracias: typeof x.gracias === 'number' ? x.gracias : 0,
      exportaciones: typeof x.exportaciones === 'number' ? x.exportaciones : 0,
    }
  })
}

// ── Config GLOBAL (un único doc) + difusión de mensajes ────────────────────────
// `config/global`: lo leen TODOS los clientes al abrir (1 lectura) para saber si el donador está
// activo y si hay un mensaje de difusión pendiente. Lo escribe sólo el admin. `difusion/{id}`: el
// historial de mensajes (lo lista el admin); el mensaje "actual" viaja embebido en config/global
// para que cada usuario lo vea UNA vez sin leer toda la colección.
const CONFIG = 'config'
const CONFIG_DOC = 'global'
const DIFUSION = 'difusion'
const CONFIG_CACHE_KEY = 'planilla-config-cache'

export interface AppConfig {
  /** ¿El donador (beggar) aparece para todos? Default true (comportamiento histórico). */
  beggarActivo: boolean
  /** Mensaje de difusión actual ('' = ninguno). Cada usuario lo ve una vez (ver App). */
  difusionId: string
  difusionTitulo: string
  difusionCuerpo: string
  difusionCreatedAt: number
}

const CONFIG_DEFAULT: AppConfig = {
  beggarActivo: true, difusionId: '', difusionTitulo: '', difusionCuerpo: '', difusionCreatedAt: 0,
}

function parseConfig(x: Record<string, unknown>): AppConfig {
  return {
    beggarActivo: typeof x.beggarActivo === 'boolean' ? x.beggarActivo : true,
    difusionId: typeof x.difusionId === 'string' ? x.difusionId : '',
    difusionTitulo: typeof x.difusionTitulo === 'string' ? x.difusionTitulo : '',
    difusionCuerpo: typeof x.difusionCuerpo === 'string' ? x.difusionCuerpo : '',
    difusionCreatedAt: typeof x.difusionCreatedAt === 'number' ? x.difusionCreatedAt : 0,
  }
}

/** Config cacheada en localStorage: disponible sincrónicamente al arrancar y resiste el modo offline. */
export function configCacheada(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY)
    if (raw) return parseConfig(JSON.parse(raw))
  } catch { /* ignore */ }
  return { ...CONFIG_DEFAULT }
}

function cachearConfig(cfg: AppConfig): void {
  try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(cfg)) } catch { /* ignore */ }
}

/** Lee la config global (1 lectura). Cachea el resultado; si falla (offline/reglas) devuelve la caché.
 *  Es una lectura AUTOMÁTICA, así que NO cuenta contra el tope diario por dispositivo. */
export async function leerConfigNube(): Promise<AppConfig> {
  try {
    const snap = await getDoc(doc(getDb(), CONFIG, CONFIG_DOC))
    contarUso(1, 0)
    const cfg = snap.exists() ? parseConfig(snap.data() as Record<string, unknown>) : { ...CONFIG_DEFAULT }
    cachearConfig(cfg)
    return cfg
  } catch {
    return configCacheada()
  }
}

/** [admin] Activa/desactiva el donador para TODOS. Merge: no pisa el mensaje de difusión actual. */
export async function setBeggarActivo(activo: boolean): Promise<void> {
  await setDoc(doc(getDb(), CONFIG, CONFIG_DOC), { beggarActivo: activo, updatedAt: Date.now() }, { merge: true })
  registrarOperacionNube()
  contarUso(0, 1)
  cachearConfig({ ...configCacheada(), beggarActivo: activo })
}

export interface DifusionEntry {
  id: string
  titulo: string
  cuerpo: string
  createdAt: number
}

/** [admin] Envía un mensaje de difusión: lo guarda en el historial y lo marca como "actual" en config. */
export async function enviarDifusion(titulo: string, cuerpo: string): Promise<DifusionEntry> {
  const t = titulo.trim(), c = cuerpo.trim()
  const createdAt = Date.now()
  const id = String(createdAt)
  await setDoc(doc(getDb(), DIFUSION, id), { titulo: t, cuerpo: c, createdAt })
  await setDoc(
    doc(getDb(), CONFIG, CONFIG_DOC),
    { difusionId: id, difusionTitulo: t, difusionCuerpo: c, difusionCreatedAt: createdAt, updatedAt: Date.now() },
    { merge: true },
  )
  registrarOperacionNube()
  contarUso(0, 2)
  cachearConfig({ ...configCacheada(), difusionId: id, difusionTitulo: t, difusionCuerpo: c, difusionCreatedAt: createdAt })
  return { id, titulo: t, cuerpo: c, createdAt }
}

/** [admin] Lista el historial de mensajes de difusión (más nuevos primero). */
export async function listarDifusiones(): Promise<DifusionEntry[]> {
  const snap = await getDocs(collection(getDb(), DIFUSION))
  registrarOperacionNube()
  contarUso(Math.max(1, snap.docs.length), 0)
  return snap.docs.map(d => {
    const x = d.data() as Partial<DifusionEntry>
    return {
      id: d.id,
      titulo: String(x.titulo ?? ''),
      cuerpo: String(x.cuerpo ?? ''),
      createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0,
    }
  }).sort((a, b) => b.createdAt - a.createdAt)
}

export type ResultadoRestore = 'ok' | 'no-existe' | 'clave-incorrecta'

/**
 * Baja el doc, descifra e importa (reemplaza los datos locales). Devuelve 'no-existe' si no hay
 * backup para esas credenciales y 'clave-incorrecta' si el descifrado AES-GCM no valida.
 * Lanza solo ante errores de red.
 */
export async function restaurarBackupNube(usuario: string, codigo: string): Promise<ResultadoRestore> {
  const snap = await getDoc(doc(getDb(), COLLECTION, await computeDocId(usuario, codigo)))
  registrarOperacionNube()
  contarUso(1, 0)
  if (!snap.exists()) return 'no-existe'
  const d = snap.data() as BackupDoc
  try {
    const key = await deriveKey(usuario, codigo, b64ToBytes(d.salt))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(d.iv) }, key, b64ToBytes(d.data))
    await importBackupJSON(new TextDecoder().decode(pt))
    return 'ok'
  } catch {
    return 'clave-incorrecta'
  }
}

/** ¿Existe un respaldo en la nube para esas credenciales? (para ofrecer restaurar en DB vacía). */
export async function existeBackupNube(usuario: string, codigo: string): Promise<boolean> {
  const snap = await getDoc(doc(getDb(), COLLECTION, await computeDocId(usuario, codigo)))
  registrarOperacionNube()
  contarUso(1, 0)
  return snap.exists()
}

/** Marca de tiempo (ms) del último backup en la nube para esas credenciales, o null si no existe. */
export async function fechaBackupNube(usuario: string, codigo: string): Promise<number | null> {
  const snap = await getDoc(doc(getDb(), COLLECTION, await computeDocId(usuario, codigo)))
  registrarOperacionNube()
  contarUso(1, 0)
  return snap.exists() ? ((snap.data() as BackupDoc).updatedAt ?? null) : null
}
