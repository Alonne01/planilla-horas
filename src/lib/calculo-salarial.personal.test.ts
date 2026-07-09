// Adicionales y retenciones personales (PERS-A* / PERS-R*) en el cálculo salarial.
// Caso real de referencia: básico 644 = 606.113,47 con retención "Cuota alimentaria"
// 35% base NETO y adicional "Mayor función" fijo $310.175,74 remunerativo.
import { describe, it, expect } from 'vitest'
import { calcularSueldo, type SalaryConfig } from './calculo-salarial'

const BASICO_644 = 606_113.47
const MAYOR_FUNCION = 310_175.74

function cfg(convenio: SalaryConfig['convenio'], extra: Partial<SalaryConfig> = {}): SalaryConfig {
  return {
    convenio,
    sueldoBasico: BASICO_644,
    antiguedadAnios: 0,
    tipoTurno: 'NINGUNO',
    zonaVacaMuerta: true,
    tasaDesarraigo644: 0.20,
    lineaTrabajo: 'SURFACE_WELL_TESTING',
    adicionalesPersonales: [],
    retencionesPersonales: [],
    ...extra,
  }
}

describe('adicionales personales (644)', () => {
  const base = calcularSueldo([], cfg('CCT_644_12'))

  it('"Mayor función" fijo remunerativo entra a los fijos y SUBE la base imponible', () => {
    const est = calcularSueldo([], cfg('CCT_644_12', {
      adicionalesPersonales: [{ nombre: 'Mayor función', esPorcentajeBasico: false, valor: MAYOR_FUNCION, remunerativo: true }],
    }))
    const item = est.fijoItems.find(i => i.codigo === 'PERS-A0')
    expect(item?.concepto).toBe('Mayor función')
    expect(item?.monto).toBeCloseTo(MAYOR_FUNCION, 2)
    // La BI sube el adicional MÁS su 6% de presentismo: en el 644 el presentismo se calcula
    // sobre todo lo remunerativo incluido el adicional (verificado recibo operador 06/2026:
    // presentismo $340.603,34 = 6% de fijos con Mayor función + variables, exacto).
    expect(est.baseImponibleRaw).toBeCloseTo(base.baseImponibleRaw + MAYOR_FUNCION * 1.06, 2)
    // Tributa aportes: jubilación 11% crece con la base (sin tope en este escenario)
    const jub = (e: typeof est) => e.retencionItems.find(i => i.codigo === '20000')!.monto
    expect(jub(est) - jub(base)).toBeCloseTo(MAYOR_FUNCION * 1.06 * 0.11, 2)
  })

  it('adicional % del básico remunerativo = básico × valor/100', () => {
    const est = calcularSueldo([], cfg('CCT_644_12', {
      adicionalesPersonales: [{ nombre: 'Plus 10%', esPorcentajeBasico: true, valor: 10, remunerativo: true }],
    }))
    expect(est.fijoItems.find(i => i.codigo === 'PERS-A0')?.monto).toBeCloseTo(BASICO_644 * 0.10, 2)
  })

  it('adicional NO remunerativo va al bloque no remunerativo y NO toca la base imponible', () => {
    const est = calcularSueldo([], cfg('CCT_644_12', {
      adicionalesPersonales: [{ nombre: 'Bono propio', esPorcentajeBasico: false, valor: 50_000, remunerativo: false }],
    }))
    expect(est.noRemItems.find(i => i.codigo === 'PERS-A0')?.monto).toBeCloseTo(50_000, 2)
    expect(est.fijoItems.some(i => i.codigo.startsWith('PERS'))).toBe(false)
    expect(est.baseImponibleRaw).toBeCloseTo(base.baseImponibleRaw, 2)
    expect(est.bruto).toBeCloseTo(base.bruto + 50_000, 2)
  })

  it('filas vacías o en cero se ignoran', () => {
    const est = calcularSueldo([], cfg('CCT_644_12', {
      adicionalesPersonales: [
        { nombre: '', esPorcentajeBasico: false, valor: 99_999, remunerativo: true },
        { nombre: 'Sin valor', esPorcentajeBasico: false, valor: 0, remunerativo: true },
      ],
      retencionesPersonales: [{ nombre: '', esPorcentaje: true, valor: 35, base: 'NETO' }],
    }))
    expect(est.fijoItems.some(i => i.codigo.startsWith('PERS'))).toBe(false)
    expect(est.retencionItems.some(i => i.codigo.startsWith('PERS'))).toBe(false)
    expect(est.netoEstimado).toBeCloseTo(base.netoEstimado, 2)
  })
})

describe('retenciones personales (644)', () => {
  const base = calcularSueldo([], cfg('CCT_644_12'))

  it('"Cuota alimentaria" 35% base NETO descuenta 35% del (bruto − retenciones de ley)', () => {
    const est = calcularSueldo([], cfg('CCT_644_12', {
      retencionesPersonales: [{ nombre: 'Cuota alimentaria', esPorcentaje: true, valor: 35, base: 'NETO' }],
    }))
    // El neto-antes-de-la-retención (bruto − ret. de ley) es el neto del cálculo base
    const esperado = 0.35 * base.netoEstimado
    const item = est.retencionItems.find(i => i.codigo === 'PERS-R0')
    expect(item?.concepto).toBe('Cuota alimentaria')
    expect(item?.monto).toBeCloseTo(esperado, 2)
    expect(est.netoEstimado).toBeCloseTo(base.netoEstimado - esperado, 2)
    expect(est.bruto).toBeCloseTo(base.bruto, 2) // la retención no toca el bruto
  })

  it('bases REMUNERATIVO / REMUNERATIVO_NETO / BASICO / BRUTO', () => {
    const retLey = base.retenciones // sin personales, todas son de ley
    const casos: { b: 'REMUNERATIVO' | 'REMUNERATIVO_NETO' | 'BASICO' | 'BRUTO'; esperado: number }[] = [
      { b: 'REMUNERATIVO', esperado: base.baseImponibleRaw * 0.10 },
      { b: 'REMUNERATIVO_NETO', esperado: (base.baseImponibleRaw - retLey) * 0.10 },
      { b: 'BASICO', esperado: BASICO_644 * 0.10 },
      { b: 'BRUTO', esperado: base.bruto * 0.10 },
    ]
    for (const { b, esperado } of casos) {
      const est = calcularSueldo([], cfg('CCT_644_12', {
        retencionesPersonales: [{ nombre: 'Ret', esPorcentaje: true, valor: 10, base: b }],
      }))
      expect(est.retencionItems.find(i => i.codigo === 'PERS-R0')?.monto).toBeCloseTo(esperado, 2)
    }
  })

  it('retención de monto fijo descuenta exactamente ese monto del neto', () => {
    const est = calcularSueldo([], cfg('CCT_644_12', {
      retencionesPersonales: [{ nombre: 'Embargo', esPorcentaje: false, valor: 150_000, base: 'NETO' }],
    }))
    expect(est.netoEstimado).toBeCloseTo(base.netoEstimado - 150_000, 2)
  })
})

describe('ítems personales en el 637 (mismo comportamiento)', () => {
  const BASICO_637 = 2_057_223.77
  const base = calcularSueldo([], cfg('CCT_637_11', { sueldoBasico: BASICO_637 }))

  it('adicional remunerativo sube la base imponible; retención NETO descuenta del neto', () => {
    const est = calcularSueldo([], cfg('CCT_637_11', {
      sueldoBasico: BASICO_637,
      adicionalesPersonales: [{ nombre: 'Mayor función', esPorcentajeBasico: false, valor: MAYOR_FUNCION, remunerativo: true }],
      retencionesPersonales: [{ nombre: 'Cuota alimentaria', esPorcentaje: true, valor: 35, base: 'NETO' }],
    }))
    expect(est.fijoItems.find(i => i.codigo === 'PERS-A0')?.monto).toBeCloseTo(MAYOR_FUNCION, 2)
    expect(est.baseImponibleRaw).toBeCloseTo(base.baseImponibleRaw + MAYOR_FUNCION, 2)
    const ret = est.retencionItems.find(i => i.codigo === 'PERS-R0')!
    // 35% del neto-antes-de-la-retención de ESTE cálculo (ya incluye el adicional)
    expect(ret.monto).toBeCloseTo(0.35 * (est.bruto - (est.retenciones - ret.monto)), 2)
    expect(est.netoEstimado).toBeCloseTo(est.bruto - est.retenciones, 2)
  })

  it('adicional no remunerativo va al bloque no remunerativo del 637', () => {
    const est = calcularSueldo([], cfg('CCT_637_11', {
      sueldoBasico: BASICO_637,
      adicionalesPersonales: [{ nombre: 'Vianda extra propia', esPorcentajeBasico: true, valor: 5, remunerativo: false }],
    }))
    expect(est.noRemItems.find(i => i.codigo === 'PERS-A0')?.monto).toBeCloseTo(BASICO_637 * 0.05, 2)
    expect(est.baseImponibleRaw).toBeCloseTo(base.baseImponibleRaw, 2)
  })
})
