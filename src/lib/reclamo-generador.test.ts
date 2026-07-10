import { describe, it, expect } from 'vitest'
import type { AnalisisRecibo } from './recibo-comparador'
import { generarReclamo, renderListaPuntos } from './reclamo-generador'

// Fixtures armadas a partir de los dos recibos reales (04/2026 y 05/2026), con las
// horas de viaje incluidas a propósito para verificar que el generador SIEMPRE las excluye.

const analisis05: AnalisisRecibo = {
  veredicto: 'PAGO_INCOMPLETO',
  totalFaltante: 82909.35,
  resumenLocal: '',
  hallazgos: [
    { codigo: '3130', concepto: 'Horas Viaje', esperado: null, pagado: 179880, dif: -42049.53, unidadesEsperadas: 10, unidadesPagadas: 3, severidad: 'FALTANTE', nota: 'Liquidaron 3 hs y la planilla tiene 10 hs: faltan 7 hs = $42.049,53.' },
    { codigo: '3150', concepto: 'Extras 50%', esperado: 1490000, pagado: 1449140.18, dif: -40859.82, unidadesEsperadas: 73, unidadesPagadas: 71, severidad: 'FALTANTE', nota: 'Liquidaron 71 hs y la planilla tiene 73 hs: faltan 2 hs = $40.859,82.' },
    { codigo: '3172', concepto: 'Desarraigo 20%', esperado: 1160891.5, pagado: 1150000, dif: -10891.5, severidad: 'TOLERANCIA', nota: 'Dentro de la banda del estimado.' },
    { codigo: '20130', concepto: 'Cuota Sindical 2,73%', esperado: 245000, pagado: 230036.91, dif: -14963.09, severidad: 'REVISAR', nota: 'No cierra contra la base (fijos + viaje + extras) del propio recibo.' },
    { codigo: '20131', concepto: 'Mutual PJ 4,09%', esperado: 367000, pagado: 344634.05, dif: -22365.95, severidad: 'REVISAR', nota: 'No cierra contra la base (fijos + viaje + extras) del propio recibo.' },
    { codigo: '3001', concepto: 'Sueldo Básico', esperado: 2057224, pagado: 2057224, dif: 0, severidad: 'OK' },
  ],
}

const analisis04: AnalisisRecibo = {
  veredicto: 'PAGO_INCOMPLETO',
  totalFaltante: 248873.79,
  resumenLocal: '',
  hallazgos: [
    { codigo: '3130', concepto: 'Horas Viaje', esperado: 36042.45, pagado: 42049.53, dif: 6007.08, unidadesEsperadas: 6, unidadesPagadas: 7, severidad: 'TOLERANCIA', nota: 'Liquidaron más horas que la planilla (7 vs 6).' },
    { codigo: '3150', concepto: 'Extras 50%', esperado: 1307514.34, pagado: 1205364.78, dif: -102149.56, unidadesEsperadas: 64, unidadesPagadas: 59, severidad: 'FALTANTE', nota: 'Liquidaron 59 hs y la planilla tiene 64 hs: faltan 5 hs = $102.149,56.' },
    { codigo: '3155', concepto: 'Extras 100%', esperado: 3241545.98, pagado: 3105346.57, dif: -136199.41, unidadesEsperadas: 119, unidadesPagadas: 114, severidad: 'FALTANTE', nota: 'Liquidaron 114 hs y la planilla tiene 119 hs: faltan 5 hs = $136.199,41.' },
    { codigo: '40316', concepto: 'Desayuno y Merienda', esperado: 189432, pagado: 178907.18, dif: -10524.82, unidadesEsperadas: 36, unidadesPagadas: 34, severidad: 'REVISAR', nota: 'Liquidaron 34 y el conteo del período da ~36: faltan 2 uds = $10.524,82 (conteo operativo, estimado).' },
  ],
}

describe('generarReclamo', () => {
  it('excluye las horas de viaje aunque sean FALTANTE', () => {
    const r = generarReclamo(analisis05, null)
    expect(r.puntos.map(p => p.codigo)).not.toContain('3130')
  })

  it('clasifica FALTANTE→puntos y REVISAR→consultas (05/2026)', () => {
    const r = generarReclamo(analisis05, null)
    expect(r.puntos.map(p => p.codigo)).toEqual(['3150'])
    expect(r.consultas.map(p => p.codigo).sort()).toEqual(['20130', '20131'])
  })

  it('el total reclamable suma solo los puntos duros, sin viaje (05/2026)', () => {
    const r = generarReclamo(analisis05, null)
    expect(r.totalReclamable).toBeCloseTo(40859.82, 2)
  })

  it('marca recurrencia cuando el concepto ya venía observado el período anterior', () => {
    const r = generarReclamo(analisis05, analisis04)
    expect(r.puntos.find(p => p.codigo === '3150')?.recurrente).toBe(true)
    expect(r.hayRecurrencia).toBe(true)
  })

  it('sin período anterior no hay recurrencia', () => {
    const r = generarReclamo(analisis05, null)
    expect(r.hayRecurrencia).toBe(false)
  })

  it('la recurrencia ignora el viaje del período anterior', () => {
    // 3130 está observado en 05 (FALTANTE) pero jamás debe marcar recurrencia.
    const r = generarReclamo(analisis04, analisis05)
    expect(r.puntos.find(p => p.codigo === '3130')).toBeUndefined()
  })

  it('04/2026: dos extras duros + desayuno como consulta, total sin viaje', () => {
    const r = generarReclamo(analisis04, null)
    expect(r.puntos.map(p => p.codigo)).toEqual(['3150', '3155'])
    expect(r.consultas.map(p => p.codigo)).toEqual(['40316'])
    expect(r.totalReclamable).toBeCloseTo(238348.97, 2)
  })
})

describe('renderListaPuntos', () => {
  it('incluye concepto, monto, total y la marca de recurrencia', () => {
    const txt = renderListaPuntos(generarReclamo(analisis05, analisis04))
    expect(txt).toContain('Extras 50%')
    expect(txt).toContain('$40.859,82')
    expect(txt).toContain('Total a reclamar')
    expect(txt.toLowerCase()).toContain('se repite')
  })

  it('lista las consultas aparte de los puntos duros', () => {
    const txt = renderListaPuntos(generarReclamo(analisis05, null))
    expect(txt).toContain('Cuota Sindical')
    expect(txt).toContain('Mutual PJ')
  })

  it('sin diferencias devuelve un mensaje de recibo OK', () => {
    const ok: AnalisisRecibo = { veredicto: 'OK', hallazgos: [{ codigo: '3001', concepto: 'Sueldo Básico', esperado: 1, pagado: 1, dif: 0, severidad: 'OK' }], totalFaltante: 0, resumenLocal: '' }
    expect(renderListaPuntos(generarReclamo(ok, null)).toLowerCase()).toContain('sin diferencias')
  })
})
