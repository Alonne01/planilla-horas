// ─── Detector de "donó" (heurística, sin backend) ─────────────────────────────
// MercadoPago cobra desde SU app (o desde otra pestaña), así que no hay forma de confirmar el pago.
// Regla: cuenta como que donó quien TOCÓ la tacita y después SALIÓ de la app (la página quedó oculta
// o se descargó). Al volver, se agradece. Las marcas viven en localStorage para sobrevivir a que el
// sistema mate la PWA mientras la persona está en MercadoPago (al reabrir, la vuelta se detecta igual).

const TOQUE_KEY = 'planilla-donacion-ts'       // cuándo tocó la tacita
const SALIDA_KEY = 'planilla-donacion-salio-ts' // cuándo salió de la app después de tocarla

/** Tiene que salir de la app dentro de este plazo desde el toque (MercadoPago se abre a los 0,55 s). */
const VENTANA_SALIDA_MS = 15_000
/** Si vuelve después de esto, el toque se considera viejo y no se agradece. */
const VENTANA_VUELTA_MS = 2 * 60 * 60 * 1000
/** Afuera menos que esto es un parpadeo (p. ej. un cambio de foco), no una salida real. */
const MINIMO_AFUERA_MS = 2_000

function leer(key: string): number {
  try { return Number(localStorage.getItem(key) || 0) } catch { return 0 }
}
function escribir(key: string, valor: number | null): void {
  try {
    if (valor == null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(valor))
  } catch { /* storage bloqueado: la heurística no corre */ }
}

// ─── Frecuencia: la tacita aparece "a veces" ──────────────────────────────────
// Se cuenta una apertura por carga de la app; la tacita sale en la 1ª, y después 1 de cada
// `frecuencia` aperturas (la decide el admin; 1 = siempre). Así no está siempre ahí molestando.
const APERTURAS_KEY = 'planilla-cafe-aperturas'
let aperturaActual = 0

function aperturaDeEstaSesion(): number {
  if (!aperturaActual) {
    aperturaActual = leer(APERTURAS_KEY) + 1
    escribir(APERTURAS_KEY, aperturaActual)
  }
  return aperturaActual
}

/** ¿La tacita sale en esta apertura de la app? */
export function cafeTocaEstaSesion(frecuencia: number): boolean {
  if (frecuencia <= 1) return true
  return (aperturaDeEstaSesion() - 1) % frecuencia === 0
}

/** Tocó la tacita: arranca un intento nuevo (descarta una salida vieja). */
export function registrarToqueDonacion(ahora = Date.now()): void {
  escribir(TOQUE_KEY, ahora)
  escribir(SALIDA_KEY, null)
}

/** La app quedó oculta o se descargó. Cuenta sólo si fue poco después de tocar la tacita. */
export function registrarSalidaDeLaApp(ahora = Date.now()): void {
  const toque = leer(TOQUE_KEY)
  if (!toque || leer(SALIDA_KEY)) return
  if (ahora - toque <= VENTANA_SALIDA_MS) escribir(SALIDA_KEY, ahora)
}

/** La app volvió a estar visible. Devuelve true si corresponde agradecer (y consume el intento). */
export function evaluarVueltaDeDonar(ahora = Date.now()): boolean {
  const toque = leer(TOQUE_KEY)
  if (!toque) return false
  const salida = leer(SALIDA_KEY)
  if (!salida) {
    // Todavía no salió: si ya pasó el plazo, tocó pero nunca se fue → se descarta el intento.
    if (ahora - toque > VENTANA_SALIDA_MS) escribir(TOQUE_KEY, null)
    return false
  }
  escribir(TOQUE_KEY, null)
  escribir(SALIDA_KEY, null)
  return ahora - salida >= MINIMO_AFUERA_MS && ahora - toque <= VENTANA_VUELTA_MS
}
