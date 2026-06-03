// Calendario de paritarias: sueldo básico de referencia por mes de vigencia y convenio.
//
// No existe una API pública con los básicos de estos CCT (se publican en PDFs del
// gremio, en argentina.gob.ar o en consultoras), así que la "actualización
// automática" se resuelve con esta tabla: agregando una fila nueva, la proyección
// de TODOS los meses se recalcula sola y el básico cargado se reescala por paritaria.
//
// Para cargar una paritaria nueva, dos opciones:
//   1) Editar el SEED de abajo (o public/paritarias.json) y pushear → auto-deploy.
//   2) Editar public/paritarias.json en el sitio: la app lo baja y lo cachea sin
//      recompilar (override del seed). Ver refrescarParitarias().

import type { Convenio } from './calculo-salarial'

export interface ParitariaEntry {
  /** Mes de vigencia, formato 'YYYY-MM'. */
  desde: string
  /** Sueldo básico de referencia vigente desde ese mes. */
  basico: number
}

// Valores verificados contra recibos reales (ver SALARY_CALC_SPEC*.md).
const SEED: Record<Convenio, ParitariaEntry[]> = {
  CCT_644_12: [
    { desde: '2025-03', basico: 481875.64 },
    { desde: '2026-01', basico: 547815 },
    { desde: '2026-04', basico: 606113.47 },
  ],
  CCT_637_11: [
    { desde: '2026-04', basico: 2057223.77 },
  ],
}

const CACHE_KEY = 'planilla-paritarias-cache'
const REMOTE_URL = `${import.meta.env.BASE_URL}paritarias.json`

let override: Partial<Record<Convenio, ParitariaEntry[]>> | null = readCache()

function readCache(): Partial<Record<Convenio, ParitariaEntry[]>> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Descarga el calendario remoto (public/paritarias.json) y lo cachea para que la
 * próxima proyección use los valores nuevos sin recompilar. Llamar una vez al iniciar.
 * Si no hay conexión o el archivo no existe, se mantiene el seed/caché.
 */
export async function refrescarParitarias(): Promise<void> {
  try {
    const res = await fetch(REMOTE_URL, { cache: 'no-cache' })
    if (!res.ok) return
    const json = await res.json()
    if (json && typeof json === 'object') {
      override = json
      localStorage.setItem(CACHE_KEY, JSON.stringify(json))
    }
  } catch {
    /* sin conexión / sin archivo → se usa el seed o el caché previo */
  }
}

function mesKey(desde: string): number {
  const [y, m] = desde.split('-').map(Number)
  return y * 12 + (m - 1)
}

function tabla(convenio: Convenio): ParitariaEntry[] {
  const remoto = override?.[convenio]
  const base = remoto && remoto.length ? remoto : SEED[convenio]
  return [...(base ?? [])].sort((a, b) => mesKey(a.desde) - mesKey(b.desde))
}

/** Básico de la tabla vigente para (año, mes 0-based), o null si no hay dato anterior. */
function basicoTabla(convenio: Convenio, anio: number, mes0: number): number | null {
  const key = anio * 12 + mes0
  let best: ParitariaEntry | null = null
  for (const e of tabla(convenio)) {
    if (mesKey(e.desde) <= key) best = e
  }
  return best ? best.basico : null
}

/**
 * Básico proyectado para un mes dado: toma el básico manual (anclado a su fecha de
 * vigencia) y lo escala por la paritaria de la tabla, de modo que:
 *  - proyectar un mes pasado usa el básico histórico (escala hacia abajo),
 *  - al agregar una paritaria nueva, los meses siguientes se actualizan solos.
 * Si no hay datos de tabla para el convenio, devuelve el básico manual sin cambios.
 */
export function basicoProyectado(
  convenio: Convenio,
  anio: number,
  mes0: number,
  basicoManual: number,
  vigenciaMs: number | undefined,
): number {
  if (!basicoManual) return 0
  const tablaMes = basicoTabla(convenio, anio, mes0)
  const vig = vigenciaMs ? new Date(vigenciaMs) : new Date()
  const tablaVig = basicoTabla(convenio, vig.getFullYear(), vig.getMonth())
  if (tablaMes != null && tablaVig != null && tablaVig > 0) {
    return basicoManual * (tablaMes / tablaVig)
  }
  return basicoManual
}
