// Crypto por secciones para el respaldo de nube v2 ('shared' + 'salary').
// Módulo PURO (sin firebase ni Dexie): cada sección se cifra con AES-GCM y una clave
// derivada del código (PBKDF2) con salt DETERMINISTA por sección → la clave queda
// ESTABLE entre subidas, así la K_shared que la PC cachea sigue sirviendo aunque el
// teléfono re-suba. El IV es aleatorio por cifrado. El payload se comprime (gzip)
// antes de cifrar (igual criterio que el respaldo legado).
const enc = new TextEncoder()
const dec = new TextDecoder()
const PBKDF2_ITERATIONS = 100_000

// DEBE coincidir con credKey() de cloud-backup.ts (normalización nombre+código).
function credKey(usuario: string, codigo: string): string {
  return `${usuario.trim().toLowerCase()}:${codigo.trim()}`
}

// base64 con loop (el spread String.fromCharCode(...bytes) desborda con payloads grandes).
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

function soportaCompresion(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}
async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Salt determinista de 16 bytes por sección (estable entre subidas). */
async function saltSeccion(usuario: string, codigo: string, seccion: 'shared' | 'salary'): Promise<Uint8Array<ArrayBuffer>> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(credKey(usuario, codigo) + '|' + seccion))
  return new Uint8Array(h).slice(0, 16)
}

/** Deriva los 32 bytes crudos de la clave de una sección (para poder mandar K_shared a la PC). */
export async function deriveSectionBits(usuario: string, codigo: string, seccion: 'shared' | 'salary'): Promise<Uint8Array<ArrayBuffer>> {
  const salt = await saltSeccion(usuario, codigo, seccion)
  const material = await crypto.subtle.importKey('raw', enc.encode(credKey(usuario, codigo)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, material, 256)
  return new Uint8Array(bits)
}

export async function importAesKey(rawKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export interface Seccion { iv: string; data: string; comp?: 'gzip' }

/** Cifra un objeto JSON en una sección {iv,data,comp}. */
export async function cifrarSeccion(key: CryptoKey, obj: unknown): Promise<Seccion> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  let plano: Uint8Array<ArrayBuffer> = enc.encode(JSON.stringify(obj))
  let comp: 'gzip' | undefined
  if (soportaCompresion()) { try { plano = await gzip(plano); comp = 'gzip' } catch { /* crudo */ } }
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plano)
  const s: Seccion = { iv: bufToB64(iv.buffer), data: bufToB64(ct) }
  if (comp) s.comp = comp
  return s
}

/** Descifra una sección {iv,data,comp} a objeto. Lanza si la clave no valida. */
export async function descifrarSeccion<T>(key: CryptoKey, s: Seccion): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(s.iv) }, key, b64ToBytes(s.data))
  const bytes = s.comp === 'gzip' ? await gunzip(new Uint8Array(pt)) : new Uint8Array(pt)
  return JSON.parse(dec.decode(bytes)) as T
}
