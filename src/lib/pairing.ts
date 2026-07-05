// Handshake efímero PC↔teléfono (estilo WhatsApp Web): la PC muestra un QR con su
// clave pública ECDH efímera; el teléfono cifra un "permiso" hacia esa clave y lo deja
// en Firestore; solo esa PC (con su privada, en RAM) puede abrirlo.
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore/lite'
import { initializeApp, getApps, getApp } from 'firebase/app'

const firebaseConfig = {
  apiKey: 'AIzaSyCuR0lmbieDncR00XVA2GSQwAjflFIKki0',
  authDomain: 'planillas-backups-986dd.firebaseapp.com',
  projectId: 'planillas-backups-986dd',
  storageBucket: 'planillas-backups-986dd.firebasestorage.app',
  messagingSenderId: '479377881165',
  appId: '1:479377881165:web:e4da9fbdf25c6b374ac404',
}
function db() { return getFirestore(getApps().length ? getApp() : initializeApp(firebaseConfig)) }
const PAIRING = 'pairing'

export interface Permiso { docId: string; kSharedB64: string; usuario: string }
export interface Sobre { pub: string; iv: string; data: string; expiresAt: number; createdAt: number }
export interface PayloadQR { v: 1; sid: string; pk: string }

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function generarParPC(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>
}
export async function exportarPub(pub: CryptoKey): Promise<string> {
  return b64(await crypto.subtle.exportKey('raw', pub))
}
async function importarPub(pkB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(pkB64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
}
async function derivarWrap(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Teléfono: genera su propio par, deriva K_wrap con la pub de la PC y cifra el permiso. */
export async function sellarPermiso(pkPCb64: string, permiso: Permiso): Promise<Sobre> {
  const parTel = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as CryptoKeyPair
  const wrap = await derivarWrap(parTel.privateKey, await importarPub(pkPCb64))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrap, new TextEncoder().encode(JSON.stringify(permiso)))
  return { pub: await exportarPub(parTel.publicKey), iv: b64(iv.buffer), data: b64(ct), expiresAt: 0, createdAt: 0 }
}

/** PC: deriva K_wrap con la pub del teléfono y descifra el permiso. Lanza si no valida. */
export async function abrirPermiso(privPC: CryptoKey, sobre: Sobre): Promise<Permiso> {
  const wrap = await derivarWrap(privPC, await importarPub(sobre.pub))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sobre.iv) }, wrap, unb64(sobre.data))
  return JSON.parse(new TextDecoder().decode(pt)) as Permiso
}

// ── Transporte Firestore (colección efímera `pairing/{sid}`) ─────────────────
export function nuevoSid(): string { return crypto.randomUUID().replace(/-/g, '') }

/** Teléfono: escribe el sobre cifrado. TTL de 2 min para el handshake. */
export async function escribirSobre(sid: string, sobre: Omit<Sobre, 'expiresAt' | 'createdAt'>, ahoraMs: number): Promise<void> {
  await setDoc(doc(db(), PAIRING, sid), { ...sobre, createdAt: ahoraMs, expiresAt: ahoraMs + 120_000 })
}
/** PC: lee el sobre (null si aún no llegó o expiró). */
export async function leerSobre(sid: string, ahoraMs: number): Promise<Sobre | null> {
  const snap = await getDoc(doc(db(), PAIRING, sid))
  if (!snap.exists()) return null
  const s = snap.data() as Sobre
  return s.expiresAt && s.expiresAt < ahoraMs ? null : s
}
/** PC: borra el sobre tras consumirlo. */
export async function borrarSobre(sid: string): Promise<void> {
  try { await deleteDoc(doc(db(), PAIRING, sid)) } catch { /* best-effort */ }
}
