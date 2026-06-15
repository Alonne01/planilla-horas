// Respaldo en la nube (Firebase Firestore) CIFRADO, direccionado por usuario + código de 6 dígitos.
//
// El usuario+código nunca viajan en claro: el id del documento es base64url(SHA-256("usuario:codigo"))
// y el contenido va cifrado con AES-GCM (clave derivada del código vía PBKDF2). Sin el código no se
// puede ni calcular el id ni descifrar el contenido. Espeja el enfoque PBKDF2 de EquipTrack
// (util/BackupPinManager.kt). La privacidad la completan las reglas Firestore (get sí, list/delete no).
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore/lite'
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

/** Uso de operaciones de nube de HOY en este dispositivo, para el medidor de admin (estilo "usage").
 *  El tope se reinicia a la medianoche local. */
export function usoNubeHoy(): { usadas: number; tope: number; sinTope: boolean; resetEnMs: number } {
  const now = new Date()
  const manana = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return { usadas: opsHoy(), tope: MAX_OPS_DIA, sinTope: esAdminDispositivo(), resetEnMs: manana - now.getTime() }
}
/** Cuenta una operación de nube (lectura o escritura) contra el tope diario. */
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
    const { donaciones, gracias } = leerMetricas()
    const entry: PadronEntry = {
      nombre: usuario.trim(), linea: lineaTxt, updatedAt: Date.now(), version: APP_VERSION, donaciones, gracias,
    }
    await setDoc(doc(getDb(), PADRON, docId), entry)
  } catch { /* el padrón es secundario: si falla, el respaldo igual quedó subido */ }
  registrarOperacionNube()
}

/**
 * Lista el padrón (nombre + línea + última actividad de cada usuario) para la pantalla de admin.
 * Requiere reglas Firestore que permitan list/read en la colección `padron`. Lanza ante error de red
 * o permisos. Cuenta como una operación de nube (anti-abuso de cuota).
 */
export async function listarPadronNube(): Promise<PadronEntry[]> {
  const snap = await getDocs(collection(getDb(), PADRON))
  registrarOperacionNube()
  return snap.docs.map(d => {
    const x = d.data() as Partial<PadronEntry>
    return {
      nombre: String(x.nombre ?? '').trim(),
      linea: String(x.linea ?? '').trim(),
      updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : 0,
      version: x.version != null ? String(x.version) : undefined,
      donaciones: typeof x.donaciones === 'number' ? x.donaciones : 0,
      gracias: typeof x.gracias === 'number' ? x.gracias : 0,
    }
  })
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
  return snap.exists()
}

/** Marca de tiempo (ms) del último backup en la nube para esas credenciales, o null si no existe. */
export async function fechaBackupNube(usuario: string, codigo: string): Promise<number | null> {
  const snap = await getDoc(doc(getDb(), COLLECTION, await computeDocId(usuario, codigo)))
  registrarOperacionNube()
  return snap.exists() ? ((snap.data() as BackupDoc).updatedAt ?? null) : null
}
