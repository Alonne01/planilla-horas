import { describe, it, expect } from 'vitest'
import { analizarDobleFranja } from './calculo-horas'

describe('analizarDobleFranja', () => {
  it('05–10 + 16–23 es válido y suma 12 h', () => {
    const r = analizarDobleFranja('05:00', '10:00', '16:00', '23:00')
    expect(r.error).toBeNull()
    expect(r.horas1).toBe(5)
    expect(r.horas2).toBe(7)
    expect(r.totalCrudo).toBe(12)
    expect(r.segundaCruzaMedianoche).toBe(false)
    expect(r.superaTope).toBe(false)
  })

  it('franjas superpuestas → error', () => {
    const r = analizarDobleFranja('05:00', '12:00', '10:00', '15:00')
    expect(r.error).toMatch(/superpone/i)
  })

  it('segunda franja que empieza justo cuando termina la primera es válida', () => {
    expect(analizarDobleFranja('05:00', '10:00', '10:00', '12:00').error).toBeNull()
  })

  it('primera franja cruzando medianoche → error', () => {
    const r = analizarDobleFranja('20:00', '02:00', '05:00', '08:00')
    expect(r.error).toMatch(/primera franja/i)
  })

  it('05–10 + 19–07: segunda cruza medianoche y supera el tope de 16 h', () => {
    const r = analizarDobleFranja('05:00', '10:00', '19:00', '07:00')
    expect(r.error).toBeNull()
    expect(r.segundaCruzaMedianoche).toBe(true)
    expect(r.totalCrudo).toBe(17)
    expect(r.superaTope).toBe(true)
  })

  it('franja de duración 0 → error', () => {
    expect(analizarDobleFranja('05:00', '10:00', '12:00', '12:00').error).toMatch(/0 h/)
  })

  it('incompleto → sin análisis', () => {
    const r = analizarDobleFranja('05:00', '10:00', '16:00', '')
    expect(r.error).toBeNull()
    expect(r.totalCrudo).toBe(0)
  })
})
