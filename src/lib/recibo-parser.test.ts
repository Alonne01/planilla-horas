// Parser de recibos (capa de texto del PDF), anclado por (descripción, código).
// Fixture 644: líneas REALES de un recibo de operador 06/2026 (sin nombre/CUIL),
// duplicadas estilo "X ... X" (layout ORIGINAL/DUPLICADO) para probar el dedupe.
import { describe, it, expect } from 'vitest'
import { parsearRecibo } from './recibo-parser'

/** Duplica la fila en la misma línea, como deja la extracción ORIGINAL/DUPLICADO. */
const dup = (s: string) => `${s}   ${s}`

const FIXTURE_644 = [
  'RECIBO DE HABERES ORIGINAL RECIBO DE HABERES DUPLICADO',
  dup('06/2026 Mensuales 06/07/2026'),
  dup('Sueldo básico CCT 644/12 2 606,113.47'),
  dup('Diferencial turno A 18 200,017.45'),
  dup('Adicional zona vacamuerta 85% 24 685,211.28'),
  dup('Antigüedad 30 2 12,014.24'),
  dup('Mayor función 50 310,175.74'),
  dup('Bono paz social 100 251,776.77'),
  dup('Adicional torre/campo 102 402,738.36'),
  dup('Horas viaje 150 20.00 120,142.40'),
  dup('Horas extras 50% 170 60.00 1,234,023.65'),
  dup('Horas extras 100% 171 47.00 1,288,869.15'),
  dup('Desarraigo 20% 191 17 565,639.88'),
  dup('Presentismo 6% 300 340,603.34'),
  dup('Jubilación 11% 20000 485,611.76'),
  dup('Ley 19.032 3% 20001 132,439.57'),
  dup('Obra social 3% 20002 132,439.57'),
  dup('Cuota sindical 20100 127,946.51'),
  dup('Cuota solidaria 20101 127,946.51'),
  dup('Mutual MEOPP 20102 238,723.62'),
  dup('Cuota alimentaria (G1)* 20198 1,728,316.32'),
  dup('Vianda 40010 19 681,130.05'),
  dup('Vianda horas extras 40012 37 690,949.47'),
  dup('Desayuno y merienda 40016 36 188,048.88'),
  dup('Asignación vianda complementaria IG 42200 480,074.13'),
  dup('Asignación vianda complem fija 42210 546,197.40'),
  dup('Asignación Vaca Muerta 42220 380,000.00'),
  dup('Retención imp. ganancias 90000 574,103.30'),
  'Total neto : 0.00',
  'Total neto : 5,436,199.00',
].join('\n')

describe('parser recibo 644 (códigos cortos anclados por descripción)', () => {
  const r = parsearRecibo(FIXTURE_644, 'CCT_644_12')

  it('extrae período abonado y total neto (máximo de los matches: la pág. 1 trae 0.00)', () => {
    expect(r.periodoAbonado).toBe('06/2026')
    expect(r.totalNeto).toBeCloseTo(5_436_199.0, 2)
  })

  it('parsea los 26 conceptos con sus montos exactos (dedupe ORIGINAL/DUPLICADO)', () => {
    const montos: Record<string, number> = {
      '2': 606_113.47, '18': 200_017.45, '24': 685_211.28, '30': 12_014.24,
      '50': 310_175.74, '100': 251_776.77, '102': 402_738.36, '150': 120_142.40,
      '170': 1_234_023.65, '171': 1_288_869.15, '191': 565_639.88, '300': 340_603.34,
      '20000': 485_611.76, '20001': 132_439.57, '20002': 132_439.57,
      '20100': 127_946.51, '20101': 127_946.51, '20102': 238_723.62, '20198': 1_728_316.32,
      '40010': 681_130.05, '40012': 690_949.47, '40016': 188_048.88,
      '42200': 480_074.13, '42210': 546_197.40, '42220': 380_000.0, '90000': 574_103.30,
    }
    expect(Object.keys(r.conceptos).sort()).toEqual(Object.keys(montos).sort())
    for (const [cod, monto] of Object.entries(montos)) {
      expect(r.conceptos[cod]?.monto, `monto de ${cod}`).toBeCloseTo(monto, 2)
    }
  })

  it('separa unidades (número corto sin miles ANTES del monto) del monto', () => {
    const unidades: Record<string, number> = {
      '30': 2,       // años de antigüedad
      '150': 20, '170': 60, '171': 47,  // horas
      '191': 17,     // días
      '40010': 19, '40012': 37, '40016': 36,  // viandas/desayunos
    }
    for (const [cod, u] of Object.entries(unidades)) {
      expect(r.conceptos[cod]?.unidades, `unidades de ${cod}`).toBe(u)
    }
    // Los conceptos sin unidades no deben inventarlas.
    expect(r.conceptos['2']?.unidades).toBeNull()
    expect(r.conceptos['300']?.unidades).toBeNull()
  })

  it('los códigos cortos NO se confunden con unidades de otras filas', () => {
    // "Antigüedad 30 2 ..." trae un "2" suelto que NO debe pisar el básico (cód. 2),
    // y "Horas extras 50% ..." trae "50" que NO debe pisar Mayor función (cód. 50).
    expect(r.conceptos['2']?.monto).toBeCloseTo(606_113.47, 2)
    expect(r.conceptos['50']?.monto).toBeCloseTo(310_175.74, 2)
  })
})

describe('parser recibo 637 (mínimo: básico + horas viaje con unidades + neto)', () => {
  const FIXTURE_637 = [
    dup('06/2026 Mensuales 06/07/2026'),
    dup('Sueldo básico CCT 637/11 3001 2,057,223.77'),
    dup('Horas viaje 3130 26.00 156,185.20'),
    'Total neto : 0.00',
    'Total neto : 4,491,559.00',
  ].join('\n')
  const r = parsearRecibo(FIXTURE_637, 'CCT_637_11')

  it('parsea básico, horas viaje con unidades, período y neto', () => {
    expect(r.conceptos['3001']?.monto).toBeCloseTo(2_057_223.77, 2)
    expect(r.conceptos['3130']?.monto).toBeCloseTo(156_185.20, 2)
    expect(r.conceptos['3130']?.unidades).toBe(26)
    expect(r.periodoAbonado).toBe('06/2026')
    expect(r.totalNeto).toBeCloseTo(4_491_559.0, 2)
  })

  it('no parsea conceptos que no están en el texto', () => {
    expect(Object.keys(r.conceptos).sort()).toEqual(['3001', '3130'])
  })
})
