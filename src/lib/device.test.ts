import { describe, it, expect } from 'vitest'
import { esTelefonoPorUA } from './device'

describe('esTelefonoPorUA', () => {
  it('detecta Android como teléfono', () => {
    expect(esTelefonoPorUA('Mozilla/5.0 (Linux; Android 14; Pixel) ...')).toBe(true)
  })
  it('detecta iPhone como teléfono', () => {
    expect(esTelefonoPorUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 ...)')).toBe(true)
  })
  it('NO detecta un desktop Windows como teléfono', () => {
    expect(esTelefonoPorUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...')).toBe(false)
  })
})
