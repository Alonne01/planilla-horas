import { describe, it, expect } from 'vitest'
import { esFrancoPorDiagrama, DIAGRAMAS } from './diagrama'

describe('diagrama 14 × 14', () => {
  const inicio = new Date(2026, 10, 1, 12).getTime()  // 1-nov: primer día de trabajo
  const dia = (n: number) => new Date(2026, 10, n, 12).getTime()

  it('está en la lista con 14 de trabajo y 14 de franco', () => {
    const d = DIAGRAMAS.find(x => x.key === 'D14X14')
    expect(d).toMatchObject({ diasTrabajo: 14, diasFranco: 14 })
  })

  it('días 1 a 14 trabajo, 15 a 28 franco, 29 vuelve a trabajo', () => {
    expect(esFrancoPorDiagrama(dia(1), 'D14X14', inicio)).toBe(false)
    expect(esFrancoPorDiagrama(dia(14), 'D14X14', inicio)).toBe(false)
    expect(esFrancoPorDiagrama(dia(15), 'D14X14', inicio)).toBe(true)
    expect(esFrancoPorDiagrama(dia(28), 'D14X14', inicio)).toBe(true)
    expect(esFrancoPorDiagrama(dia(29), 'D14X14', inicio)).toBe(false)
  })

  it('antes de la fecha de inicio también rota (31-oct = último franco del ciclo anterior)', () => {
    expect(esFrancoPorDiagrama(new Date(2026, 9, 31, 12).getTime(), 'D14X14', inicio)).toBe(true)
  })
})
