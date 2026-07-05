import { describe, it, expect } from 'vitest'
import { generarParPC, exportarPub, sellarPermiso, abrirPermiso, type Permiso } from './pairing'

describe('handshake E2E ECDH', () => {
  it('solo la PC (con su privada) puede abrir el permiso', async () => {
    const pc = await generarParPC()
    const pkB64 = await exportarPub(pc.publicKey)
    const permiso: Permiso = { docId: 'doc1', kSharedB64: 'AAAA', usuario: 'Juan' }
    const sobre = await sellarPermiso(pkB64, permiso)          // lo hace el teléfono
    const abierto = await abrirPermiso(pc.privateKey, sobre)   // lo hace la PC
    expect(abierto).toEqual(permiso)
  })
  it('otra PC no puede abrirlo', async () => {
    const pc = await generarParPC(); const otra = await generarParPC()
    const sobre = await sellarPermiso(await exportarPub(pc.publicKey), { docId: 'd', kSharedB64: 'k', usuario: 'u' })
    await expect(abrirPermiso(otra.privateKey, sobre)).rejects.toBeTruthy()
  })
})
