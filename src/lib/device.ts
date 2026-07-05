// Detección teléfono-vs-PC. No es perfecta (tablets grandes / laptops touch pueden
// clasificar mal); se acepta el tradeoff. El sueldo queda hard-off si NO es teléfono.

/** Parte testeable: solo mira el user-agent. */
export function esTelefonoPorUA(ua: string): boolean {
  return /Android|iPhone|iPod|Windows Phone|Opera Mini|IEMobile/i.test(ua)
}

/** Heurística completa (usa APIs del navegador). Cachear el resultado en un módulo o estado. */
export function isMobilePhone(): boolean {
  try {
    const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData
    if (uaData?.mobile === true) return true
    const coarse =
      matchMedia('(pointer: coarse)').matches &&
      navigator.maxTouchPoints > 0 &&
      matchMedia('(max-width: 820px)').matches
    if (coarse) return true
    return esTelefonoPorUA(navigator.userAgent)
  } catch {
    return esTelefonoPorUA(navigator.userAgent)
  }
}
