import { describe, it, expect } from 'vitest'
import { esValida, renovar, type PCSession } from './pc-session'

const base: PCSession = { docId: 'd', kSharedB64: 'k', usuario: 'Juan', expiresAt: 1000 }

describe('sesión de PC', () => {
  it('válida antes de expirar', () => expect(esValida(base, 999)).toBe(true))
  it('inválida al expirar', () => expect(esValida(base, 1000)).toBe(false))
  it('renovar corre expiresAt 24h desde ahora', () => {
    const r = renovar(base, 5000)
    expect(r.expiresAt).toBe(5000 + 24 * 60 * 60 * 1000)
  })
})
