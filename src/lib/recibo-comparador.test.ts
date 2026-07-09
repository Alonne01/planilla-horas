// Comparador recibo ↔ estimación del período (portado de EquipTrack ReciboComparador.kt).
// Caso "todo OK": recibo sintético armado DESDE el estimado → veredicto OK, sin faltantes.
// Caso faltante: 20 hs de viaje en la planilla vs 7 en el recibo → FALTANTE = 13 × tarifa.
import { describe, it, expect } from 'vitest'
import { calcularSueldo, type SalaryConfig, type SalaryEstimate } from './calculo-salarial'
import type { RegistroHoras } from '../db/database'
import { compararRecibo } from './recibo-comparador'
import type { ConceptoRecibo, ReciboParseado } from './recibo-parser'

const BASICO_637 = 2_057_223.77

function cfg(convenio: SalaryConfig['convenio'], extra: Partial<SalaryConfig> = {}): SalaryConfig {
  return {
    convenio,
    sueldoBasico: BASICO_637,
    antiguedadAnios: 7,
    tipoTurno: 'NINGUNO',
    zonaVacaMuerta: true,
    tasaDesarraigo644: 0.20,
    lineaTrabajo: 'SURFACE_WELL_TESTING',
    adicionalesPersonales: [],
    retencionesPersonales: [],
    ...extra,
  }
}

/** Día de Campo de junio 2026: 08–20 (12 hs → 8 normales + 4 al 50%) + 2 hs de viaje. */
function regCampo(dia: number): RegistroHoras {
  return {
    id: `r${dia}`,
    fechaMs: new Date(2026, 5, dia).getTime(),
    entradaInicioMs: new Date(2026, 5, dia, 8, 0).getTime(),
    salidaInicioMs: new Date(2026, 5, dia, 20, 0).getTime(),
    entradaFinMs: null,
    salidaFinMs: null,
    lugarTrabajo: 'Campo',
    pernocte: 'Trailer',
    maneja: false,
    horasViaje: 2,
    observaciones: '',
    proyecto: '',
    esFeriado: false,
    esFeriadoTrabajado: false,
    esFrancoCompensatorio: false,
    esFrancoTrabajado: false,
    esAusenciaJustificada: false,
    esFaltaInjustificada: false,
    fechaCreacion: 0,
  }
}

// 10 días de campo → 20 hs de viaje, 40 hs al 50%, 10 días trabajados.
const REGISTROS = Array.from({ length: 10 }, (_, i) => regCampo(i + 1))

function itemDe(est: SalaryEstimate, cod: string) {
  return [...est.fijoItems, ...est.variableItems, ...est.noRemItems, ...est.retencionItems]
    .find(i => i.codigo === cod)
}

function unidadesDe(concepto: string | undefined): number | null {
  const m = concepto ? /\((\d+)/.exec(concepto) : null
  return m ? Number(m[1]) : null
}

/** Recibo sintético 637 "todo OK" armado desde el estimado; `viajeUds` simula que
 *  RRHH liquidó menos horas de viaje (a la MISMA tarifa del convenio). */
function armarRecibo637(est: SalaryEstimate, viajeUds?: number): ReciboParseado {
  const conceptos: Record<string, ConceptoRecibo> = {}
  const add = (codigo: string, monto: number, unidades: number | null = null) => {
    conceptos[codigo] = { codigo, descripcion: codigo, unidades, monto }
  }
  for (const cod of ['3001', '3010', '3050', '3060', '3065', '3373', '3374']) {
    const it = itemDe(est, cod)
    if (it && it.monto > 0.005) add(cod, it.monto)
  }
  const tarifaViaje = est.horaBase * 0.44105
  const uds = viajeUds ?? est.totalViaje
  if (est.totalViaje > 0) add('3130', uds * tarifaViaje, uds)
  if (est.totalExtra50 > 0) add('3150', itemDe(est, '3150')!.monto, est.totalExtra50)
  if (est.totalExtra100 > 0) add('3155', itemDe(est, '3155')!.monto, est.totalExtra100)
  const desarraigo = itemDe(est, '3172')
  if (desarraigo) add('3172', desarraigo.monto)
  const v310 = itemDe(est, '40310')
  if (v310) add('40310', v310.monto, est.diasTrabajados)
  const v312 = itemDe(est, '40312')
  if (v312) add('40312', v312.monto, unidadesDe(v312.concepto))
  const v316 = itemDe(est, '40316')
  if (v316) add('40316', v316.monto, unidadesDe(v316.concepto))
  add('42210', itemDe(est, '42210')!.monto)
  add('42220', itemDe(est, '42220')!.monto)
  const gan = itemDe(est, '90000')
  if (gan) { add('90000', gan.monto); add('42100', gan.monto / 2) }
  for (const cod of ['20000', '20001', '20002']) {
    const it = itemDe(est, cod)
    if (it) add(cod, it.monto)
  }
  // Sindical/mutual coherentes con la base del PROPIO recibo (como las verifica el comparador).
  const base = ['3001', '3010', '3050', '3060', '3065', '3373', '3374', '3130', '3150', '3155']
    .reduce((s, c) => s + (conceptos[c]?.monto ?? 0), 0)
  add('20130', base * 0.0273)
  add('20131', base * 0.0409)
  return { convenio: 'CCT_637_11', periodoAbonado: '06/2026', conceptos, totalNeto: est.netoEstimado }
}

describe('comparador 637: recibo que espeja el estimado', () => {
  const est = calcularSueldo(REGISTROS, cfg('CCT_637_11'))

  it('la estimación del período tiene las horas esperadas', () => {
    expect(est.totalViaje).toBe(20)
    expect(est.totalExtra50).toBe(40)
    expect(est.diasTrabajados).toBe(10)
  })

  it('todo OK: veredicto OK, sin faltantes ni REVISAR', () => {
    const res = compararRecibo(armarRecibo637(est), est)
    expect(res.veredicto).toBe('OK')
    expect(res.totalFaltante).toBe(0)
    expect(res.hallazgos.some(h => h.severidad === 'FALTANTE' || h.severidad === 'REVISAR')).toBe(false)
    // Las horas de viaje cierran en tarifa Y cantidad.
    const viaje = res.hallazgos.find(h => h.codigo === '3130')
    expect(viaje?.severidad).toBe('OK')
    expect(viaje?.unidadesEsperadas).toBe(20)
    expect(viaje?.unidadesPagadas).toBe(20)
    expect(res.hallazgos.filter(h => h.severidad === 'OK').length).toBeGreaterThanOrEqual(10)
  })

  it('faltante de horas de viaje: 20 en planilla vs 7 en recibo → FALTANTE = 13 × tarifa', () => {
    const res = compararRecibo(armarRecibo637(est, 7), est)
    const tarifa = est.horaBase * 0.44105

    const viaje = res.hallazgos.find(h => h.codigo === '3130' && h.severidad === 'FALTANTE')
    expect(viaje).toBeDefined()
    expect(viaje!.unidadesEsperadas).toBe(20)
    expect(viaje!.unidadesPagadas).toBe(7)
    expect(viaje!.dif).toBeCloseTo(-13 * tarifa, 6)

    // La tarifa por hora estaba bien: NO debe haber hallazgo de tarifa.
    expect(res.hallazgos.some(h => h.concepto.includes('tarifa'))).toBe(false)

    expect(res.veredicto).toBe('PAGO_INCOMPLETO')
    expect(res.totalFaltante).toBeCloseTo(13 * tarifa, 6)
    expect(res.resumenLocal).toContain('Pago incompleto')
  })
})

describe('comparador 644: adicionales y retenciones personales por nombre', () => {
  const MAYOR_FUNCION = 310_175.74
  const est = calcularSueldo([], cfg('CCT_644_12', {
    sueldoBasico: 606_113.47,
    antiguedadAnios: 0,
    adicionalesPersonales: [{ nombre: 'Mayor función', esPorcentajeBasico: false, valor: MAYOR_FUNCION, remunerativo: true }],
    retencionesPersonales: [{ nombre: 'Cuota alimentaria', esPorcentaje: true, valor: 35, base: 'NETO' }],
  }))
  const cuotaEsperada = est.retencionItems.find(i => i.codigo === 'PERS-R0')!.monto

  function armarRecibo644(): ReciboParseado {
    const conceptos: Record<string, ConceptoRecibo> = {}
    const add = (codigo: string, monto: number, descripcion = codigo) => {
      conceptos[codigo] = { codigo, descripcion, unidades: null, monto }
    }
    for (const cod of ['2', '18', '24', '100', '102', '300', '42210', '42220']) {
      add(cod, itemDe(est, cod)!.monto)
    }
    // Mayor función viaja con el código corto 50 del recibo (la app la estima como PERS-A0).
    add('50', MAYOR_FUNCION, 'Mayor función')
    // Cuota alimentaria: código 20198 del recibo, $1.000 arriba de lo configurado.
    add('20198', cuotaEsperada + 1000, 'Cuota alimentaria')
    return { convenio: 'CCT_644_12', periodoAbonado: '06/2026', conceptos, totalNeto: null }
  }

  it('matchea "Mayor función" (cód. 50) contra el adicional personal → exacto OK', () => {
    const res = compararRecibo(armarRecibo644(), est)
    const mf = res.hallazgos.find(h => h.codigo === '50')
    expect(mf?.severidad).toBe('OK')
    expect(mf?.concepto).toBe('Mayor función')
    expect(mf?.esperado).toBeCloseTo(MAYOR_FUNCION, 2)
  })

  it('matchea la cuota alimentaria (cód. 20198) contra la retención personal → INFO con comparación', () => {
    const res = compararRecibo(armarRecibo644(), est)
    const ca = res.hallazgos.find(h => h.codigo === '20198')
    expect(ca?.severidad).toBe('INFO')
    expect(ca?.esperado).toBeCloseTo(cuotaEsperada, 2)
    expect(ca?.dif).toBeCloseTo(1000, 2)
  })

  it('los exactos del 644 que espejan el estimado dan OK y el veredicto es OK', () => {
    const res = compararRecibo(armarRecibo644(), est)
    for (const cod of ['2', '18', '24', '100', '102', '42210', '42220']) {
      expect(res.hallazgos.find(h => h.codigo === cod)?.severidad, `severidad de ${cod}`).toBe('OK')
    }
    expect(res.veredicto).toBe('OK')
    expect(res.totalFaltante).toBe(0)
  })
})
