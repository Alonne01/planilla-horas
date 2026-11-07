import { describe, it, expect } from 'vitest'
import { viandasDelDia } from './calculo-horas'

describe('viandasDelDia', () => {
  it('sin horas no corresponde vianda', () => expect(viandasDelDia(0)).toEqual({ base: 0, adicionales: 0 }))
  it('jornada de 8 h: sólo la del día', () => expect(viandasDelDia(8)).toEqual({ base: 1, adicionales: 0 }))
  it('9,5 h: todavía no llega a 2 h extra', () => expect(viandasDelDia(9.5)).toEqual({ base: 1, adicionales: 0 }))
  it('10 h: 1 adicional', () => expect(viandasDelDia(10)).toEqual({ base: 1, adicionales: 1 }))
  it('12 h de campo: 2 adicionales (como en el recibo)', () => expect(viandasDelDia(12)).toEqual({ base: 1, adicionales: 2 }))
  it('16 h: 4 adicionales', () => expect(viandasDelDia(16)).toEqual({ base: 1, adicionales: 4 }))
})
