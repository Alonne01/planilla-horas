// Parte los settings en dos: 'shared' (todo menos sueldo/código) y 'salary' (solo
// sueldo + código de nube). Así el respaldo de nube se cifra en dos secciones con
// claves distintas y la PC solo recibe la clave de 'shared' → el sueldo nunca le llega.
import { DEFAULT_SETTINGS, type AppSettings } from '../db/database'

/** Campos que SOLO viven en la sección 'salary' (phone-only). Incluye el código de nube. */
export const SALARY_FIELDS = [
  'sueldoBasico', 'sueldoBasicoVigenciaMs', 'convenio', 'fechaIngresoMs', 'tipoTurno',
  'zonaVacaMuerta', 'tasaDesarraigo644', 'tieneGuardiaPasiva', 'valorGuardiaDia',
  'adicionalCampoRate', 'bonoPazRate644', 'solidaria644', 'backupCodigo', 'backupBloqueado',
  'adicionalesPersonales', 'retencionesPersonales',
] as const satisfies ReadonlyArray<keyof AppSettings>

type SalaryField = (typeof SALARY_FIELDS)[number]

export function partirSettings(s: AppSettings): {
  shared: Partial<AppSettings>
  salary: Partial<AppSettings>
} {
  const shared: Record<string, unknown> = {}
  const salary: Record<string, unknown> = {}
  const salarySet = new Set<string>(SALARY_FIELDS)
  for (const [k, v] of Object.entries(s)) {
    if (k === 'id') continue
    if (salarySet.has(k)) salary[k] = v
    else shared[k] = v
  }
  return { shared: shared as Partial<AppSettings>, salary: salary as Partial<AppSettings> }
}

export function combinarSettings(
  shared: Partial<AppSettings>, salary: Partial<AppSettings>,
): AppSettings {
  return { ...DEFAULT_SETTINGS, ...shared, ...salary, id: 1 }
}

export type { SalaryField }
