import { describe, it, expect } from 'vitest'
import { esNombreAdmin, debeReanclarCodigoAdmin, CODIGO_ADMIN } from './calculo-salarial'

describe('esNombreAdmin', () => {
  it('reconoce "Nicolas Vazquez" exacto', () => {
    expect(esNombreAdmin('Nicolas Vazquez')).toBe(true)
  })
  it('ignora acentos, mayúsculas y espacios de más', () => {
    expect(esNombreAdmin('  nicolás   vázquez ')).toBe(true)
    expect(esNombreAdmin('NICOLAS VAZQUEZ')).toBe(true)
  })
  it('rechaza otros nombres', () => {
    expect(esNombreAdmin('Juan Perez')).toBe(false)
    expect(esNombreAdmin('Nicolas')).toBe(false)
    expect(esNombreAdmin('')).toBe(false)
  })
  it('rechaza null/undefined', () => {
    expect(esNombreAdmin(null)).toBe(false)
    expect(esNombreAdmin(undefined)).toBe(false)
  })
})

describe('debeReanclarCodigoAdmin', () => {
  it('true si es el admin y el código está vacío', () => {
    expect(debeReanclarCodigoAdmin('Nicolas Vazquez', '')).toBe(true)
    expect(debeReanclarCodigoAdmin('nicolás vázquez', '   ')).toBe(true)
  })
  it('false si el admin ya tiene un código', () => {
    expect(debeReanclarCodigoAdmin('Nicolas Vazquez', CODIGO_ADMIN)).toBe(false)
    expect(debeReanclarCodigoAdmin('Nicolas Vazquez', '123456')).toBe(false)
  })
  it('false si no es el admin (aunque el código esté vacío)', () => {
    expect(debeReanclarCodigoAdmin('Juan Perez', '')).toBe(false)
    expect(debeReanclarCodigoAdmin(null, '')).toBe(false)
  })
  it('el código admin es 000000', () => {
    expect(CODIGO_ADMIN).toBe('000000')
  })
})
