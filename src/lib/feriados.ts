// Feriados nacionales de Argentina que se pagan al 100% si se trabajan.
//
// Sólo incluye los de tipo "inamovible" y "trasladable". NO incluye feriados puente
// ni días no laborables (religiosos/turísticos): ésos NO se pagan al 100% — se pagan
// como un día normal, así que para el cálculo de horas valen como día común.
//
// Cada feriado guarda además su NOMBRE (qué se conmemora) para mostrarlo en la UI.
// La lista se puede actualizar desde Configuración (API pública argentinadatos.com).
// El seed de abajo (2025-2026) está verificado contra esa misma fuente y sirve de
// respaldo offline si nunca se actualizó.

const STORAGE_KEY = 'planilla-feriados-nacionales'

/** Semilla offline: feriados nacionales 2025-2026 (inamovibles + trasladables) con su nombre. */
const SEED: Record<string, string> = {
  // 2025
  '2025-01-01': 'Año Nuevo',
  '2025-03-03': 'Carnaval',
  '2025-03-04': 'Carnaval',
  '2025-03-24': 'Día de la Memoria por la Verdad y la Justicia',
  '2025-04-02': 'Día del Veterano y de los Caídos en Malvinas',
  '2025-04-18': 'Viernes Santo',
  '2025-05-01': 'Día del Trabajador',
  '2025-05-25': 'Día de la Revolución de Mayo',
  '2025-06-16': 'Paso a la Inmortalidad del Gral. Güemes',
  '2025-06-20': 'Día de la Bandera (Gral. Belgrano)',
  '2025-07-09': 'Día de la Independencia',
  '2025-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2025-10-12': 'Día del Respeto a la Diversidad Cultural',
  '2025-11-24': 'Día de la Soberanía Nacional',
  '2025-12-08': 'Inmaculada Concepción de María',
  '2025-12-25': 'Navidad',
  // 2026
  '2026-01-01': 'Año Nuevo',
  '2026-02-16': 'Carnaval',
  '2026-02-17': 'Carnaval',
  '2026-03-24': 'Día de la Memoria por la Verdad y la Justicia',
  '2026-04-02': 'Día del Veterano y de los Caídos en Malvinas',
  '2026-04-03': 'Viernes Santo',
  '2026-05-01': 'Día del Trabajador',
  '2026-05-25': 'Día de la Revolución de Mayo',
  // 17/6 (Güemes) cae miércoles y por trasladable se observa el lunes 15/6.
  '2026-06-15': 'Paso a la Inmortalidad del Gral. Güemes (17/6)',
  '2026-06-20': 'Día de la Bandera (Gral. Belgrano)',
  '2026-07-09': 'Día de la Independencia',
  '2026-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2026-10-12': 'Día del Respeto a la Diversidad Cultural',
  '2026-11-23': 'Día de la Soberanía Nacional (20/11)',
  '2026-12-08': 'Inmaculada Concepción de María',
  '2026-12-25': 'Navidad',
}

interface FeriadosCache {
  // Formato actual: fecha → nombre.
  feriados?: Record<string, string>
  // Formato legado (sólo fechas, sin nombre) — se migra al leer.
  fechas?: string[]
  actualizado: number // ms de la última actualización exitosa desde la API
}

function leerCache(): { feriados: Record<string, string>; actualizado: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as FeriadosCache
    const actualizado = typeof data?.actualizado === 'number' ? data.actualizado : 0
    if (data?.feriados && typeof data.feriados === 'object') {
      return { feriados: data.feriados, actualizado }
    }
    // Migración del formato viejo: fechas[] → mapa con nombre del seed (o genérico).
    if (Array.isArray(data?.fechas)) {
      const feriados: Record<string, string> = {}
      for (const f of data.fechas) feriados[f] = SEED[f] ?? 'Feriado nacional'
      return { feriados, actualizado }
    }
    return null
  } catch {
    return null
  }
}

// Mapa en memoria fecha→nombre: fuente sincrónica para esFeriadoNacional()/nombreFeriado().
// Arranca del seed (garantiza 2025-2026) unido a lo que el usuario haya actualizado.
let feriadosMap: Map<string, string> = (() => {
  const base = new Map<string, string>(Object.entries(SEED))
  const cache = leerCache()
  if (cache) for (const [fecha, nombre] of Object.entries(cache.feriados)) base.set(fecha, nombre)
  return base
})()

function fechaKey(fechaMs: number): string {
  const d = new Date(fechaMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function esFeriadoNacional(fechaMs: number): boolean {
  return feriadosMap.has(fechaKey(fechaMs))
}

/** Nombre del feriado (qué se conmemora) para esa fecha, o null si no es feriado nacional. */
export function nombreFeriado(fechaMs: number): string | null {
  return feriadosMap.get(fechaKey(fechaMs)) ?? null
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
 * el resto, persiste en localStorage y actualiza la cache en memoria. Guarda también el nombre.
 */
export async function actualizarFeriadosNacionales(
  years: number[] = [new Date().getFullYear(), new Date().getFullYear() + 1],
): Promise<{ total: number; years: number[] }> {
  // Partimos de lo que ya tenemos (seed ∪ cache) y reemplazamos sólo los años a actualizar.
  const nuevo = new Map<string, string>(feriadosMap)
  for (const k of [...nuevo.keys()]) {
    if (years.includes(Number(k.slice(0, 4)))) nuevo.delete(k)
  }

  for (const year of years) {
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${year}`)
    if (!res.ok) throw new Error(`No se pudo obtener feriados ${year} (HTTP ${res.status})`)
    const data = (await res.json()) as ApiFeriado[]
    if (!Array.isArray(data)) throw new Error(`Respuesta inesperada de feriados ${year}`)
    for (const f of data) {
      if ((f.tipo === 'inamovible' || f.tipo === 'trasladable') && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) {
        nuevo.set(f.fecha, f.nombre?.trim() || 'Feriado nacional')
      }
    }
  }

  feriadosMap = nuevo
  const feriados: Record<string, string> = {}
  for (const [fecha, nombre] of [...nuevo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    feriados[fecha] = nombre
  }
  const cache: FeriadosCache = { feriados, actualizado: Date.now() }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage lleno/no disponible — la actualización igual queda activa en memoria esta sesión
  }
  return { total: nuevo.size, years }
}
