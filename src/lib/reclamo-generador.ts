// Genera, a partir del AnalisisRecibo ya calculado, el "reclamo para RRHH":
// qué puntos reclamar (evidencia dura) y qué consultar (estimativo/ambiguo).
// PURO y determinístico, sin IA — igual que ReciboComparador. Espejado en EquipTrack
// (utils/recibo/ReclamoGenerador.kt).
//
// Reglas:
//  - Las HORAS DE VIAJE se excluyen SIEMPRE (se liquidan aparte del recibo mensual).
//  - FALTANTE → punto de reclamo (suma al total, es hora×tarifa o concepto faltante).
//  - REVISAR  → consulta (estimativo: sindical/mutual, desarraigo, conteo de viandas…).
//  - Recurrencia: un concepto se marca "se repite" si el mismo código ya venía
//    observado (FALTANTE/REVISAR, sin viaje) en el análisis del período anterior.

import type { AnalisisRecibo, Hallazgo } from './recibo-comparador'

/** Códigos de horas de viaje (637 y 644): fuera del reclamo. */
const CODIGOS_VIAJE = new Set(['3130', '150'])

export interface PuntoReclamo {
  codigo: string
  concepto: string
  /** Diferencia en contra (negativa) cuando aplica. */
  dif: number | null
  nota?: string
  /** El mismo concepto ya venía observado el período anterior. */
  recurrente: boolean
}

export interface Reclamo {
  /** Hallazgos FALTANTE sin viaje (evidencia dura): suman al total. */
  puntos: PuntoReclamo[]
  /** Hallazgos REVISAR sin viaje (consultas / estimativos): no suman. */
  consultas: PuntoReclamo[]
  /** Suma de lo reclamable duro (bruto), sin viaje. */
  totalReclamable: number
  hayRecurrencia: boolean
}

export function generarReclamo(actual: AnalisisRecibo, anterior?: AnalisisRecibo | null): Reclamo {
  const observadosAntes = new Set(
    (anterior?.hallazgos ?? [])
      .filter(h => (h.severidad === 'FALTANTE' || h.severidad === 'REVISAR') && !CODIGOS_VIAJE.has(h.codigo))
      .map(h => h.codigo),
  )

  const aPunto = (h: Hallazgo): PuntoReclamo => ({
    codigo: h.codigo,
    concepto: h.concepto,
    dif: h.dif,
    nota: h.nota,
    recurrente: observadosAntes.has(h.codigo),
  })

  const relevantes = actual.hallazgos.filter(h => !CODIGOS_VIAJE.has(h.codigo))
  const puntos = relevantes.filter(h => h.severidad === 'FALTANTE').map(aPunto)
  const consultas = relevantes.filter(h => h.severidad === 'REVISAR').map(aPunto)
  const totalReclamable = puntos.reduce((s, p) => s + (p.dif != null && p.dif < 0 ? -p.dif : 0), 0)
  const hayRecurrencia = [...puntos, ...consultas].some(p => p.recurrente)

  return { puntos, consultas, totalReclamable, hayRecurrencia }
}

/** Lista de puntos seca, lista para copiar y pegarle a RRHH (formato de la PWA). */
export function renderListaPuntos(reclamo: Reclamo): string {
  if (reclamo.puntos.length === 0 && reclamo.consultas.length === 0) {
    return 'El recibo cierra con el cálculo del período: sin diferencias para reclamar.'
  }

  const lineas: string[] = ['Diferencias en el recibo para reclamar a RRHH:', '']

  if (reclamo.puntos.length > 0) {
    for (const p of reclamo.puntos) lineas.push(`• ${bullet(p)}`)
  } else {
    lineas.push('• Sin diferencias duras; ver consultas abajo.')
  }

  if (reclamo.consultas.length > 0) {
    lineas.push('', 'Consultas / a verificar:')
    for (const c of reclamo.consultas) lineas.push(`• ${bullet(c)}`)
  }

  if (reclamo.totalReclamable > 0) {
    lineas.push('', `Total a reclamar (bruto): ${fmt(reclamo.totalReclamable)}`)
  }

  return lineas.join('\n')
}

function bullet(p: PuntoReclamo): string {
  const cuerpo = p.nota
    ? `${p.concepto}: ${p.nota}`
    : `${p.concepto}${p.dif != null ? ` (${fmt(p.dif)})` : ''}`
  return p.recurrente ? `${cuerpo} (se repite respecto del período anterior)` : cuerpo
}

function fmt(v: number): string {
  return '$' + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
