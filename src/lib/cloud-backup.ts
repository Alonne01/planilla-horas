// Respaldo en la nube (Firebase Firestore) CIFRADO, direccionado por usuario + código de 6 dígitos.
//
// El usuario+código nunca viajan en claro: el id del documento es base64url(SHA-256("usuario:codigo"))
// y el contenido va cifrado con AES-GCM (clave derivada del código vía PBKDF2). Sin el código no se
// puede ni calcular el id ni descifrar el contenido. Espeja el enfoque PBKDF2 de EquipTrack
// (util/BackupPinManager.kt). La privacidad la completan las reglas Firestore (get sí, list/delete no).
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, increment, type Firestore } from 'firebase/firestore/lite'
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

// ── Último nombre con el que se respaldó en la nube (para detectar correcciones de nombre) ──────
// El respaldo se direcciona por hash(nombre:código). Si el usuario corrige su nombre (mismo código),
// el id cambia y queda un respaldo huérfano. Guardamos acá el último nombre respaldado para poder
// migrarlo (ver migrarBackupNube en Settings). Se setea en cada subida/migración exitosa.
const ULTIMO_USUARIO_KEY = 'planilla-cloud-ultimo-usuario'
export function ultimoUsuarioNube(): string {
  try { return localStorage.getItem(ULTIMO_USUARIO_KEY) ?? '' } catch { return '' }
}
export function setUltimoUsuarioNube(usuario: string): void {
  try { localStorage.setItem(ULTIMO_USUARIO_KEY, usuario.trim()) } catch { /* ignore */ }
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

/** Clave localStorage del último mensaje de difusión VISTO por este dispositivo (lo setea App al
 *  cerrar el cartel). Se sube en el padrón para que el admin sepa quién vio la última difusión. */
export const DIFUSION_VISTA_KEY = 'planilla-difusion-vista'
function difusionVistaLocal(): string {
  try { return localStorage.getItem(DIFUSION_VISTA_KEY) ?? '' } catch { return '' }
}

/** Entrada del padrón (datos NO sensibles): para el conteo de usuarios y líneas en la pantalla admin. */
export interface PadronEntry {
  /** Id del documento (= SHA-256("usuario:codigo") en base64url). El admin lo usa para enviarle un
   *  mensaje individual a ESTE usuario (mensajes/{id}) sin conocer su código. No revela el código. */
  id?: string
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
  /** Id del último mensaje de difusión que vio este usuario (para "vieron la última difusión"). */
  difusionVista?: string
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
      difusionVista: difusionVistaLocal(),
    }
    await setDoc(doc(getDb(), PADRON, docId), entry)
  } catch { /* el padrón es secundario: si falla, el respaldo igual quedó subido */ }
  setUltimoUsuarioNube(usuario.trim()) // recordar bajo qué nombre quedó el respaldo (para migrar si lo corrige)
  void asegurarCodigoReservado(codigo)  // segundo candado: reserva el código si se generó offline (best-effort)
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
      id: d.id,
      nombre: String(x.nombre ?? '').trim(),
      linea: String(x.linea ?? '').trim(),
      updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : 0,
      version: x.version != null ? String(x.version) : undefined,
      donaciones: typeof x.donaciones === 'number' ? x.donaciones : 0,
      gracias: typeof x.gracias === 'number' ? x.gracias : 0,
      exportaciones: typeof x.exportaciones === 'number' ? x.exportaciones : 0,
      difusionVista: typeof x.difusionVista === 'string' ? x.difusionVista : '',
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
  beggarActivo: false, difusionId: '', difusionTitulo: '', difusionCuerpo: '', difusionCreatedAt: 0,
}

function parseConfig(x: Record<string, unknown>): AppConfig {
  return {
    // Donador APAGADO por defecto: aparece sólo cuando el admin lo activa (toggle en Admin).
    beggarActivo: typeof x.beggarActivo === 'boolean' ? x.beggarActivo : false,
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

/** [admin] Limpia el mensaje de difusión ACTUAL (deja de mostrarse a quien no lo vio). NO borra el
 *  historial (`difusion`): sólo vacía los campos de difusión en config/global. Útil para que una
 *  difusión de prueba no se "filtre" al abrir la app a todos. */
export async function limpiarDifusion(): Promise<void> {
  await setDoc(
    doc(getDb(), CONFIG, CONFIG_DOC),
    { difusionId: '', difusionTitulo: '', difusionCuerpo: '', difusionCreatedAt: 0, updatedAt: Date.now() },
    { merge: true },
  )
  registrarOperacionNube()
  contarUso(0, 1)
  cachearConfig({ ...configCacheada(), difusionId: '', difusionTitulo: '', difusionCuerpo: '', difusionCreatedAt: 0 })
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

/**
 * Verifica que EXISTE un respaldo para esas credenciales y que se DESCIFRA con el código (sin
 * importarlo). Sirve como prueba de propiedad antes de migrar/borrar un respaldo viejo: solo el
 * dueño (con el código correcto) puede descifrarlo. Devuelve 'ok' | 'no-existe' | 'clave-incorrecta'.
 */
export async function verificarBackupNube(usuario: string, codigo: string): Promise<ResultadoRestore> {
  const snap = await getDoc(doc(getDb(), COLLECTION, await computeDocId(usuario, codigo)))
  contarUso(1, 0)
  if (!snap.exists()) return 'no-existe'
  const d = snap.data() as BackupDoc
  try {
    const key = await deriveKey(usuario, codigo, b64ToBytes(d.salt))
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(d.iv) }, key, b64ToBytes(d.data))
    return 'ok'
  } catch {
    return 'clave-incorrecta'
  }
}

/** Borra el respaldo + su entrada de padrón para esas credenciales (requiere reglas con delete). */
export async function borrarBackupNube(usuario: string, codigo: string): Promise<void> {
  const docId = await computeDocId(usuario, codigo)
  await deleteDoc(doc(getDb(), COLLECTION, docId))
  try { await deleteDoc(doc(getDb(), PADRON, docId)) } catch { /* el padrón es secundario */ }
  contarUso(0, 2)
}

export interface ResultadoMigracion {
  estado: 'migrado' | 'verificado-sin-viejo' | 'codigo-incorrecto' | 'error'
  desde: string
  hacia: string
}

/**
 * Corrige el NOMBRE de un usuario que escribió mal el suyo (mismo código), sin perder su respaldo
 * ni dejar un duplicado en la nube:
 *   1) Verifica que el respaldo VIEJO (nombreViejo+código) se descifra con el código (prueba de dueño).
 *   2) Sube el respaldo actual bajo el nombre NUEVO (re-cifrado con la clave del nombre nuevo).
 *   3) Borra el respaldo + padrón VIEJOS, así queda una sola entrada limpia.
 * Si no hay respaldo viejo (o no descifra), igual sube bajo el nombre nuevo y NO borra nada.
 */
export async function migrarBackupNube(
  nombreViejo: string, nombreNuevo: string, codigo: string, linea?: string,
): Promise<ResultadoMigracion> {
  const desde = nombreViejo.trim(), hacia = nombreNuevo.trim()
  if (!credencialesNubeValidas(hacia, codigo)) return { estado: 'error', desde, hacia }
  // Sin nombre viejo distinto: nada que migrar (solo asegurar el respaldo nuevo).
  if (!desde || credKey(desde, codigo) === credKey(hacia, codigo)) {
    try { await subirBackupNube(hacia, codigo, linea) } catch { return { estado: 'error', desde, hacia } }
    return { estado: 'verificado-sin-viejo', desde, hacia }
  }
  let verif: ResultadoRestore
  try { verif = await verificarBackupNube(desde, codigo) } catch { return { estado: 'error', desde, hacia } }
  try {
    await subirBackupNube(hacia, codigo, linea) // SIEMPRE: respaldo bajo el nombre nuevo (no se pierde nada)
    if (verif === 'ok') await borrarBackupNube(desde, codigo) // borra el viejo SOLO si verificó (mismo dueño)
  } catch {
    return { estado: 'error', desde, hacia }
  }
  registrarOperacionNube()
  if (verif === 'ok') return { estado: 'migrado', desde, hacia }
  if (verif === 'clave-incorrecta') return { estado: 'codigo-incorrecto', desde, hacia }
  return { estado: 'verificado-sin-viejo', desde, hacia }
}

// ── Mensajes INDIVIDUALES (admin → un usuario) ──────────────────────────────────
// Mismo modelo que la difusión pero direccionado: el doc vive en `mensajes/{docId}` donde docId =
// hash(usuario:código) del destinatario. El admin lo obtiene del padrón (PadronEntry.id) SIN conocer
// el código. El usuario lo lee con su propio docId y, al cerrarlo, escribe `recibidoAt` (acuse). El
// cuerpo viaja en claro como la difusión, pero solo quien conoce nombre+código (o el padrón admin)
// puede ubicar el doc.
const MENSAJES = 'mensajes'

export interface MensajeIndividual {
  id: string
  titulo: string
  cuerpo: string
  createdAt: number
  /** ms en que el usuario tocó OK (0 = todavía no lo recibió/cerró). */
  recibidoAt: number
}

function parseMensaje(id: string, x: Record<string, unknown>): MensajeIndividual {
  return {
    id: typeof x.id === 'string' ? x.id : id,
    titulo: String(x.titulo ?? ''),
    cuerpo: String(x.cuerpo ?? ''),
    createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0,
    recibidoAt: typeof x.recibidoAt === 'number' ? x.recibidoAt : 0,
  }
}

/** [admin] Envía un mensaje individual al usuario cuyo docId viene del padrón. Pisa el anterior. */
export async function enviarMensajeIndividual(docId: string, titulo: string, cuerpo: string): Promise<MensajeIndividual> {
  const createdAt = Date.now()
  const msg: MensajeIndividual = { id: String(createdAt), titulo: titulo.trim(), cuerpo: cuerpo.trim(), createdAt, recibidoAt: 0 }
  await setDoc(doc(getDb(), MENSAJES, docId), msg)
  registrarOperacionNube()
  contarUso(0, 1)
  return msg
}

/** [admin] Lee el mensaje individual + su acuse para un docId (para mostrar "Recibido hace X"). */
export async function leerRecepcionMensaje(docId: string): Promise<MensajeIndividual | null> {
  const snap = await getDoc(doc(getDb(), MENSAJES, docId))
  registrarOperacionNube()
  contarUso(1, 0)
  return snap.exists() ? parseMensaje(docId, snap.data() as Record<string, unknown>) : null
}

/** [usuario] Lee SU mensaje individual (si hay). Lectura automática al abrir (no cuenta contra el tope). */
export async function leerMensajeIndividual(usuario: string, codigo: string): Promise<MensajeIndividual | null> {
  try {
    const docId = await computeDocId(usuario, codigo)
    const snap = await getDoc(doc(getDb(), MENSAJES, docId))
    contarUso(1, 0)
    return snap.exists() ? parseMensaje(docId, snap.data() as Record<string, unknown>) : null
  } catch { return null }
}

/** [usuario] Marca su mensaje individual como recibido (acuse al admin). Best-effort. */
export async function marcarMensajeRecibido(usuario: string, codigo: string): Promise<void> {
  try {
    const docId = await computeDocId(usuario, codigo)
    await setDoc(doc(getDb(), MENSAJES, docId), { recibidoAt: Date.now() }, { merge: true })
    contarUso(0, 1)
  } catch { /* acuse best-effort: no debe romper nada */ }
}

// ── Códigos ÚNICOS (segundo candado): que no se repitan entre usuarios ──────────
// Registro global `codigos/{hash}` (hash del código, NO el código en claro) para reservar cada
// código de 6 dígitos. Un 6 dígitos es enumerable, así que el registro solo revela "tomado/libre"
// (nunca el nombre ni los datos: el respaldo sigue protegido por nombre+código). Al generar, se busca
// uno libre y se reserva; el registro es inmutable (no se puede pisar el de otro).
const CODIGOS = 'codigos'

async function hashCodigo(codigo: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`planilla-codigo:${codigo.trim()}`))
  return bufToB64Url(h)
}

/** ¿El código de 6 dígitos está libre (no reservado por otro usuario)? */
export async function codigoDisponible(codigo: string): Promise<boolean> {
  const snap = await getDoc(doc(getDb(), CODIGOS, await hashCodigo(codigo)))
  contarUso(1, 0)
  return !snap.exists()
}

/** Reserva el código (registro inmutable). Lo llama generarCodigoUnico tras verificar que está libre. */
async function reservarCodigo(codigo: string): Promise<void> {
  await setDoc(doc(getDb(), CODIGOS, await hashCodigo(codigo)), { createdAt: Date.now() })
  contarUso(0, 1)
}

export interface CodigoGenerado { codigo: string; unico: boolean }

/**
 * Genera un código de 6 dígitos GARANTIZANDO que no esté en uso por otro usuario (segundo candado):
 * prueba códigos al azar hasta encontrar uno libre y lo reserva. Si no hay red para verificar
 * (`unico:false`), devuelve igual uno al azar (la reserva se reintenta en el próximo respaldo).
 */
export async function generarCodigoUnico(): Promise<CodigoGenerado> {
  const random = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  for (let i = 0; i < 12; i++) {
    const codigo = random()
    try {
      if (await codigoDisponible(codigo)) { await reservarCodigo(codigo); marcarCodigoReservadoLocal(codigo); registrarOperacionNube(); return { codigo, unico: true } }
    } catch {
      return { codigo, unico: false } // sin conexión: no se pudo verificar la unicidad (se reserva al respaldar)
    }
  }
  return { codigo: random(), unico: false } // 12 colisiones seguidas (improbable): devolver uno igual
}

// Flag local: el código que ESTE dispositivo ya reservó (o constató tomado) en el registro global.
// Evita re-chequear en cada respaldo y permite reservar OFFLINE-luego: un código generado sin conexión
// (`unico:false`) queda sin reservar; en el próximo respaldo con red, `asegurarCodigoReservado` lo reserva.
const CODIGO_RESERVADO_KEY = 'planilla-codigo-reservado'
function codigoYaReservadoLocal(codigo: string): boolean {
  try { return localStorage.getItem(CODIGO_RESERVADO_KEY) === codigo.trim() } catch { return false }
}
function marcarCodigoReservadoLocal(codigo: string): void {
  try { localStorage.setItem(CODIGO_RESERVADO_KEY, codigo.trim()) } catch { /* ignore */ }
}

/** Asegura (best-effort) que el código esté reservado en el registro global. Reserva un código que se
 *  generó OFFLINE en cuanto hay conexión (lo llama `subirBackupNube`). No rompe si falla la red. */
export async function asegurarCodigoReservado(codigo: string): Promise<void> {
  if (!/^\d{6}$/.test(codigo.trim()) || codigoYaReservadoLocal(codigo)) return
  try {
    if (await codigoDisponible(codigo)) await reservarCodigo(codigo)
    marcarCodigoReservadoLocal(codigo) // libre→reservado, o ya estaba tomado: en ambos casos no reintentar
  } catch { /* sin conexión: se reintenta en el próximo respaldo */ }
}
