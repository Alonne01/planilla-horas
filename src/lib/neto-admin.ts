// Cálculo del NETO estimado del período actual, fuera de React, para subirlo al panel de admin.
// Replica lo que muestra la pestaña "Sueldo" (ProyeccionSalarial): neto del período + proyección a
// fin de período según el diagrama. Devuelve null si el usuario no configuró su básico o no tiene
// días cargados (esos usuarios no suben neto).
import { db, getSettings } from '../db/database'
import { periodoStart, periodoEnd, defaultPeriodoMes, defaultPeriodoAnio, DIAGRAMAS } from './diagrama'
import { calcularSueldo, configFromSettings, proyectarNeto } from './calculo-salarial'
import { basicoProyectado } from './paritarias'

export interface NetoAdmin {
  /** Neto del período actual con lo cargado hasta ahora. */
  neto: number
  /** Neto proyectado a fin de período (estima los días de trabajo restantes por el diagrama). */
  proyectado: number
}

export async function calcularNetoActualParaAdmin(): Promise<NetoAdmin | null> {
  const s = await getSettings()
  if (!s.sueldoBasico || s.sueldoBasico <= 0) return null

  const mes = defaultPeriodoMes()
  const anio = defaultPeriodoAnio()
  const start = periodoStart(mes, anio).getTime()
  const end = periodoEnd(mes, anio).getTime() + 86_400_000
  const rows = await db.registros.where('fechaMs').between(start, end, true, true).toArray()
  if (rows.length === 0) return null

  const basicoMes = basicoProyectado(s.convenio, anio, mes, s.sueldoBasico, s.sueldoBasicoVigenciaMs)
  const est = calcularSueldo(rows, { ...configFromSettings(s), sueldoBasico: basicoMes })
  if (est.diasTrabajados <= 0) return null

  // Proyección a fin de período (mismo criterio que ProyeccionSalarial.calcularProyeccion).
  let proyectado = est.netoEstimado
  const startD = periodoStart(mes, anio)
  const endD = periodoEnd(mes, anio)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  if (today >= startD && today <= endD) {
    const DAY = 86_400_000
    const totalDias = Math.round((endD.getTime() - startD.getTime()) / DAY) + 1
    const transcurridos = Math.min(totalDias, Math.round((today.getTime() - startD.getTime()) / DAY) + 1)
    const restantes = Math.max(0, totalDias - transcurridos)
    const diag = DIAGRAMAS.find(d => d.key === s.diagrama) ?? DIAGRAMAS[0]
    const ratio = diag.diasTrabajo / (diag.diasTrabajo + diag.diasFranco)
    const diasTotales = est.diasTrabajados + Math.round(restantes * ratio)
    proyectado = proyectarNeto(est, diasTotales)
  }

  return { neto: Math.round(est.netoEstimado), proyectado: Math.round(proyectado) }
}
