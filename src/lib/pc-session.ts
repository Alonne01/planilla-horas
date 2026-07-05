// Sesión de la PC vinculada: persiste SOLO K_shared (nunca el código ni el sueldo).
// Vigencia 1 día sliding; se renueva con la actividad; logout/expiración la limpian.
const KEY = 'planilla-pc-session'
const DIA_MS = 24 * 60 * 60 * 1000

export interface PCSession {
  docId: string
  kSharedB64: string   // K_shared en base64 (32 bytes); NO es el código
  usuario: string
  expiresAt: number
}

export function esValida(s: PCSession | null, ahoraMs: number): s is PCSession {
  return !!s && typeof s.expiresAt === 'number' && s.expiresAt > ahoraMs
}
export function renovar(s: PCSession, ahoraMs: number): PCSession {
  return { ...s, expiresAt: ahoraMs + DIA_MS }
}

export function cargarSesion(): PCSession | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) as PCSession : null } catch { return null }
}
export function guardarSesion(s: PCSession): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}
export function limpiarSesion(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** Crea la sesión a partir del permiso abierto (K_shared va tal cual, ya en base64). */
export function crearDesdePermiso(p: { docId: string; kSharedB64: string; usuario: string }, ahoraMs: number): PCSession {
  return { docId: p.docId, kSharedB64: p.kSharedB64, usuario: p.usuario, expiresAt: ahoraMs + DIA_MS }
}
