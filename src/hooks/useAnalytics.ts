import { useEffect, useState } from 'react'
import { db, type RegistroHoras } from '../db/database'
import { periodoStart, periodoEnd, MESES_ES } from '../lib/diagrama'
import { calcularHorasDia, esDiaNoTrabajado } from '../lib/calculo-horas'

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export interface PeriodoStats {
  mes: number
  anio: number
  /** Etiqueta corta para gráficos, ej. "May" */
  label: string
  /** Etiqueta del rango, ej. "abr–may 2026" */
  rango: string
  registros: RegistroHoras[]
  total: number
  normales: number
  al50: number
  al100: number
  /** al50 + al100 */
  extra: number
  viaje: number
  diasTrabajados: number
  diasBase: number
  diasCampo: number
  diasFranco: number
  francosTrabajados: number
  feriadosTrabajados: number
  diasManejo: number
  pernoctes: number
  promedioPorDia: number
}

/** Desplaza un período (mes,anio) `delta` meses (delta negativo = hacia atrás). */
export function shiftPeriodo(mes: number, anio: number, delta: number): { mes: number; anio: number } {
  let m = mes + delta
  let a = anio
  while (m < 0) { m += 12; a-- }
  while (m > 11) { m -= 12; a++ }
  return { mes: m, anio: a }
}

function computePeriodo(mes: number, anio: number, registros: RegistroHoras[]): PeriodoStats {
  let normales = 0, al50 = 0, al100 = 0, viaje = 0
  let diasTrabajados = 0, diasBase = 0, diasCampo = 0, diasFranco = 0
  let francosTrabajados = 0, feriadosTrabajados = 0, diasManejo = 0, pernoctes = 0

  for (const reg of registros) {
    const h = calcularHorasDia(reg)
    const off = esDiaNoTrabajado(reg) || reg.esAusenciaJustificada

    if (off) {
      diasFranco++
      continue
    }

    if (h.horasTrabajadas > 0) {
      diasTrabajados++
      normales += h.horasNormales
      al50 += h.horasAl50
      al100 += h.horasAl100
    }
    viaje += reg.horasViaje ?? 0
    if (reg.maneja) diasManejo++
    if (reg.pernocte === 'Hotel' || reg.pernocte === 'Trailer') pernoctes++
    if (reg.esFrancoTrabajado) francosTrabajados++
    if (reg.esFeriadoTrabajado) feriadosTrabajados++
    if (reg.lugarTrabajo === 'Base') diasBase++
    else if (reg.lugarTrabajo === 'Campo') diasCampo++
  }

  const total = normales + al50 + al100
  const mesAnt = mes === 0 ? 11 : mes - 1

  return {
    mes,
    anio,
    label: MESES_SHORT[mes],
    rango: `${MESES_SHORT[mesAnt].toLowerCase()}–${MESES_SHORT[mes].toLowerCase()} ${anio}`,
    registros,
    total,
    normales,
    al50,
    al100,
    extra: al50 + al100,
    viaje,
    diasTrabajados,
    diasBase,
    diasCampo,
    diasFranco,
    francosTrabajados,
    feriadosTrabajados,
    diasManejo,
    pernoctes,
    promedioPorDia: diasTrabajados > 0 ? total / diasTrabajados : 0,
  }
}

/**
 * Carga las estadísticas del período (mes,anio) y los `prev` períodos anteriores.
 * Devuelve el arreglo ordenado del más antiguo al más reciente (el último es el actual).
 */
export function useAnalytics(mes: number, anio: number, prev = 2) {
  const [periodos, setPeriodos] = useState<PeriodoStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      const targets: { mes: number; anio: number }[] = []
      for (let i = prev; i >= 0; i--) targets.push(shiftPeriodo(mes, anio, -i))

      const stats = await Promise.all(
        targets.map(async ({ mes: m, anio: a }) => {
          const start = periodoStart(m, a).getTime()
          const end = periodoEnd(m, a).getTime() + 86_400_000
          const rows = await db.registros.where('fechaMs').between(start, end, true, true).sortBy('fechaMs')
          return computePeriodo(m, a, rows)
        }),
      )

      if (!cancelled) {
        setPeriodos(stats)
        setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [mes, anio, prev])

  return { periodos, loading }
}

export { MESES_ES }
