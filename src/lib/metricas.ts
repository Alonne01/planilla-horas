// Métricas locales NO sensibles (contadores por dispositivo) para el padrón de admin:
// cuántas veces se tocó el botón de donar, cuántas apareció el "¡Gracias!" y cuántas veces se
// exportó la planilla a Excel. Se suben junto al padrón en cada respaldo a la nube (ver cloud-backup.ts).
const TAP_DONACION_KEY = 'planilla-metrica-tap-donacion'
const GRACIAS_KEY = 'planilla-metrica-gracias'
const EXPORT_KEY = 'planilla-metrica-export'

function leerN(key: string): number {
  try { return parseInt(localStorage.getItem(key) ?? '0', 10) || 0 } catch { return 0 }
}
function sumar(key: string): void {
  try { localStorage.setItem(key, String(leerN(key) + 1)) } catch { /* localStorage lleno/no disponible */ }
}

/** Suma 1 al contador de toques al botón de donación (tap real, no deslizar). */
export function registrarTapDonacion(): void { sumar(TAP_DONACION_KEY) }

/** Suma 1 al contador de apariciones del "¡Gracias!" (al volver de donar). */
export function registrarGracias(): void { sumar(GRACIAS_KEY) }

/** Suma 1 al contador de exportaciones de la planilla a Excel (export real, no el demo del tutorial). */
export function registrarExportacion(): void { sumar(EXPORT_KEY) }

/** Lee los contadores locales para incluirlos en el padrón. */
export function leerMetricas(): { donaciones: number; gracias: number; exportaciones: number } {
  return { donaciones: leerN(TAP_DONACION_KEY), gracias: leerN(GRACIAS_KEY), exportaciones: leerN(EXPORT_KEY) }
}
