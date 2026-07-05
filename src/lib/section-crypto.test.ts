import { describe, it, expect } from 'vitest'
import { importAesKey, cifrarSeccion, descifrarSeccion, deriveSectionBits } from './section-crypto'

describe('sección AES-GCM round-trip', () => {
  it('cifra y descifra el mismo objeto', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    const key = await importAesKey(raw)
    const obj = { a: 1, registros: [{ id: 'x' }], settings: [{ nombreUsuario: 'Juan' }] }
    const sec = await cifrarSeccion(key, obj)
    expect(await descifrarSeccion(key, sec)).toEqual(obj)
  })
  it('con clave distinta falla (no leak)', async () => {
    const key1 = await importAesKey(crypto.getRandomValues(new Uint8Array(32)))
    const key2 = await importAesKey(crypto.getRandomValues(new Uint8Array(32)))
    const sec = await cifrarSeccion(key1, { secreto: 42 })
    await expect(descifrarSeccion(key2, sec)).rejects.toBeTruthy()
  })
})

describe('deriveSectionBits', () => {
  it('shared y salary dan claves distintas', async () => {
    const sh = await deriveSectionBits('Juan', '123456', 'shared')
    const sa = await deriveSectionBits('Juan', '123456', 'salary')
    expect(Buffer.from(sh).equals(Buffer.from(sa))).toBe(false)
  })
  it('es determinista (misma credencial → mismos bits)', async () => {
    const a = await deriveSectionBits('Juan', '123456', 'shared')
    const b = await deriveSectionBits('  juan ', '123456', 'shared') // normaliza trim+lowercase
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})
