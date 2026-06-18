/**
 * Flags de localStorage para el nuevo flujo de primer inicio (reemplaza al tour spotlight):
 *  - setup obligatorio: nombre y apellido → código de respaldo → primer backup a la nube.
 *  - tutorial simple: un carrusel de diapositivas, no bloqueante, reabrible desde el menú ⋮.
 */

// Se mantiene la MISMA clave del onboarding viejo: los usuarios que ya completaron el tour anterior
// la tienen en '1', así que NO vuelven a ver el setup obligatorio ni el tutorial automáticamente.
const SETUP_KEY = 'planilla-onboarding-done'
const TUTORIAL_KEY = 'planilla-tutorial-visto'
const DIAGRAMA_KEY = 'planilla-diagrama-confirmado'

/** True si el usuario ya pasó por el setup obligatorio (nombre + código + respaldo en la nube). */
export function setupHecho(): boolean {
  try { return localStorage.getItem(SETUP_KEY) === '1' } catch { return false }
}
export function marcarSetupHecho(): void {
  try { localStorage.setItem(SETUP_KEY, '1') } catch { /* ignore */ }
}

/** True si ya vio el carrusel del tutorial al menos una vez (después se reabre desde el menú ⋮). */
export function tutorialVisto(): boolean {
  try { return localStorage.getItem(TUTORIAL_KEY) === '1' } catch { return false }
}
export function marcarTutorialVisto(): void {
  try { localStorage.setItem(TUTORIAL_KEY, '1') } catch { /* ignore */ }
}

/** True si el usuario ya confirmó su diagrama (tipo + fecha de inicio). Si no, se le muestra el
 *  prompt con vista previa al abrir la app (es crucial para distinguir días de trabajo y franco). */
export function diagramaConfirmado(): boolean {
  try { return localStorage.getItem(DIAGRAMA_KEY) === '1' } catch { return false }
}
export function marcarDiagramaConfirmado(): void {
  try { localStorage.setItem(DIAGRAMA_KEY, '1') } catch { /* ignore */ }
}
