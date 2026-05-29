// Feriados nacionales de Argentina que se pagan al 100% si se trabajan.
//
// Sólo incluye los de tipo "inamovible" y "trasladable". NO incluye feriados puente
// ni días no laborables (religiosos/turísticos): ésos NO se pagan al 100% — se pagan
// como un día normal, así que para el cálculo de horas valen como día común.
//
// La lista se puede actualizar desde Configuración (API pública argentinadatos.com).
// El seed de abajo (2025-2026) está verificado contra esa misma fuente y sirve de
// respaldo offline si nunca se actualizó.

const STORAGE_KEY = 'planilla-feriados-nacionales'

/** Semilla offline: feriados nacionales 2025-2026 (inamovibles + trasladables). */
const SEED: string[] = [
  // 2025
  '2025-01-01', '2025-03-03', '2025-03-04', '2025-03-24', '2025-04-02',
  '2025-04-18', '2025-05-01', '2025-05-25', '2025-06-16', '2025-06-20',
  '2025-07-09', '2025-08-17', '2025-10-12', '2025-11-24', '2025-12-08', '2025-12-25',
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-03-24', '2026-04-02',
  '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-15', '2026-06-20',
  '2026-07-09', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-08', '2026-12-25',
]

interface FeriadosCache {
  fechas: string[]
  actualizado: number // ms de la última actualización exitosa desde la API
}

function leerCache(): FeriadosCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (Array.isArray(data?.fechas)) {
      return { fechas: data.fechas as string[], actualizado: typeof data.actualizado === 'number' ? data.actualizado : 0 }
    }
    return null
  } catch {
    return null
  }
}

// Set en memoria: fuente sincrónica para esFeriadoNacional().
// Arranca del seed (garantiza 2025-2026) unido a lo que el usuario haya actualizado.
let feriadosSet: Set<string> = (() => {
  const base = new Set(SEED)
  const cache = leerCache()
  if (cache) for (const f of cache.fechas) base.add(f)
  return base
})()

function fechaKey(fechaMs: number): string {
  const d = new Date(fechaMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function esFeriadoNacional(fechaMs: number): boolean {
  return feriadosSet.has(fechaKey(fechaMs))
}

/** ms de la última actualización desde la API, o 0 si nunca se actualizó. */
export function feriadosActualizadoMs(): number {
  return leerCache()?.actualizado ?? 0
}

interface ApiFeriado {
  fecha: string
  tipo: string
  nombre?: string
}

/**
 * Actualiza los feriados nacionales desde la API pública (argentinadatos.com) para los años
 * indicados (por defecto el año actual y el siguiente). Sólo toma los de tipo "inamovible" y
 * "trasladable" (se pagan al 100% si se trabajan); descarta "puente" y "no laborable"
 * (turísticos/religiosos → se pagan como día normal). Reemplaza sólo los años pedidos, conserva
 * el resto, persiste en localStorage y actualiza la cache en memoria.
 */
export async function actualizarFeriadosNacionales(
  years: number[] = [new Date().getFullYear(), new Date().getFullYear() + 1],
): Promise<{ total: number; years: number[] }> {
  // Partimos de lo que ya tenemos (seed ∪ cache) y reemplazamos sólo los años a actualizar.
  const nuevo = new Set<string>(feriadosSet)
  for (const k of [...nuevo]) {
    if (years.includes(Number(k.slice(0, 4)))) nuevo.delete(k)
  }

  for (const year of years) {
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${year}`)
    if (!res.ok) throw new Error(`No se pudo obtener feriados ${year} (HTTP ${res.status})`)
    const data = (await res.json()) as ApiFeriado[]
    if (!Array.isArray(data)) throw new Error(`Respuesta inesperada de feriados ${year}`)
    for (const f of data) {
      if ((f.tipo === 'inamovible' || f.tipo === 'trasladable') && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) {
        nuevo.add(f.fecha)
      }
    }
  }

  feriadosSet = nuevo
  const cache: FeriadosCache = { fechas: [...nuevo].sort(), actualizado: Date.now() }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage lleno/no disponible — la actualización igual queda activa en memoria esta sesión
  }
  return { total: nuevo.size, years }
}
