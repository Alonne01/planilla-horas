import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type TabId = 'horas' | 'analytics' | 'settings' | 'salary'

export interface TourAcciones {
  setTab?: (t: TabId) => void
  actualizarFeriados?: () => void | Promise<void>
  guardarConfig?: () => void
  abrirDiaTour?: (modo: 'ausencia' | 'trabajo') => void
  /** Abre (vacío, real) el día demo elegido + offset (0=día1, 1=día2, 2=día3) para cargarlo de verdad. */
  abrirDiaDemo?: (offset: number) => void
  cerrarDialogo?: () => void
  /** Cambia a la "planilla de prueba" (período sentinela aislado) para el tour sin tocar datos reales. */
  entrarPrueba?: () => void
  /** Sale de la planilla de prueba: borra sus datos y vuelve al período actual. */
  salirPrueba?: () => void
}

export interface Paso {
  id: string
  tab?: TabId
  /** Selector CSS del elemento a resaltar (o función que lo devuelve). Sin target → tarjeta centrada. */
  target?: string
  titulo?: string
  texto: string
  /** Si devuelve true, el paso se saltea (p.ej. no existe el campo de fecha de diagrama). */
  skipIf?: () => boolean
  /** Acción al entrar al paso (cambiar de pantalla ya lo hace `tab`). */
  onEnter?: (a: TourAcciones) => void
  /** Avanza solo cuando este predicado (que consulta el DOM) da true. Para campos a completar. */
  done?: () => boolean
  /** Avanza cuando el usuario TOCA el elemento resaltado. Para botones/opciones. */
  avanzaAlTocar?: boolean
  /** Overlay NO bloqueante (sólo tarjeta + glow): para pasos con interacción libre (pintar/borrar,
   *  selector de hora). El avance lo dispara el estado de la pantalla (HorasTrabajo → onb.next()). */
  libre?: boolean
  /** Espera estos ms antes de avanzar (tras tocar/completar), para que el usuario vea el cambio. */
  delayMs?: number
  /** Sólo con `done`: en vez de un delay fijo desde que se cumple, espera `delayMs` ms SIN input
   *  (debounce de tipeo). Cada tecla reinicia la cuenta → no salta al primer carácter (p.ej. el nombre). */
  debounce?: boolean
  /** Avanza SÓLO por una acción externa (p.ej. Guardar) — sin botón "Siguiente". */
  accionExterna?: boolean
  /** Auto-avanza tras estos ms aunque no haya interacción (p.ej. campo opcional como "¿Manejaste?"). */
  autoMs?: number
}

export type TourModo = 'full' | 'cloud'

const STORAGE_KEY = 'planilla-onboarding-done'

export function onboardingHecho(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

// Helpers para leer el DOM en los predicados `done`.
const qs = (sel: string) => document.querySelector(sel) as HTMLElement | null
const valDe = (sel: string) => (qs(sel) as HTMLInputElement | null)?.value ?? ''

// ─── Tour completo (sólo Nicolas) ───────────────────────────────────────────
const PASOS: Paso[] = [
  {
    id: 'bienvenida',
    titulo: '¡Bienvenido!',
    texto: 'Te muestro cómo configurar y usar la planilla en un minuto. Hacé lo que te marco para avanzar; podés salir cuando quieras.',
  },
  {
    id: 'cfg-nombre', tab: 'settings', target: '[data-tour="cfg-nombre"]',
    titulo: 'Tu nombre', texto: 'Escribí tu nombre completo: se usa en la planilla, en el Excel que exportás y en el respaldo en la nube.',
    done: () => valDe('[data-tour="cfg-nombre"]').trim().length > 0,
    delayMs: 7000, debounce: true, // avanza recién tras 7 s sin tipear (no salta al primer carácter)
  },
  {
    id: 'cfg-respaldo', tab: 'settings', target: '[data-tour="cfg-respaldo"]',
    titulo: 'Respaldo en la nube',
    texto: 'Tocá Generar: crea tu código y tu planilla se guarda cifrada en la nube, sola cada pocos días. Anotá tu nombre + código.',
    done: () => valDe('[data-tour="cfg-respaldo"] input').replace(/\D/g, '').length === 6,
  },
  {
    id: 'cfg-linea', tab: 'settings', target: '[data-tour="cfg-linea"]',
    titulo: 'Línea de trabajo', texto: 'Tocá tu línea de trabajo: afecta cómo se cuentan las horas.',
    avanzaAlTocar: true,
  },
  {
    id: 'cfg-diagrama', tab: 'settings', target: '[data-tour="cfg-diagrama"]',
    titulo: 'Diagrama', texto: 'Tocá tu diagrama de trabajo (días de campo y francos).',
    avanzaAlTocar: true,
  },
  {
    id: 'cfg-fecha', tab: 'settings', target: '[data-tour="cfg-fecha"]',
    titulo: 'Inicio del diagrama', texto: 'Elegí el día que subís al campo: marca el arranque del diagrama.',
    skipIf: () => !document.querySelector('[data-tour="cfg-fecha"]'),
    done: () => valDe('[data-tour="cfg-fecha"]').length > 0,
  },
  {
    id: 'cfg-feriados', tab: 'settings', target: '[data-tour="cfg-feriados"]',
    titulo: 'Feriados', texto: 'Tocá para actualizar los feriados nacionales.',
    avanzaAlTocar: true,
  },
  // ── Día 1: una ausencia (se carga y guarda de verdad) ──
  {
    id: 'g-aus-dia', tab: 'horas', target: '[data-tour="hrs-dia"]',
    titulo: 'Día 1: una ausencia', texto: 'Tocá el día iluminado del calendario para abrirlo.',
    onEnter: a => { a.cerrarDialogo?.() },
    avanzaAlTocar: true,
  },
  {
    id: 'g-aus-marcar', tab: 'horas', target: '[data-tour="dlg-ausencia"]',
    titulo: 'Marcá la ausencia', texto: 'Si faltaste, no cargás horario: tocá un tipo (Compensatorio, Ausencia o Falta).',
    avanzaAlTocar: true,
  },
  {
    id: 'g-aus-obs', tab: 'horas', target: '[data-tour="dlg-obs"]',
    titulo: 'Observación', texto: 'Anotá una observación (ej: "médico").',
    done: () => valDe('[data-tour="dlg-obs"] input').trim().length > 0,
    delayMs: 1500, debounce: true, // avanza recién tras 1,5 s sin tipear
  },
  {
    id: 'g-aus-guardar', tab: 'horas', target: '[data-tour="dlg-guardar"]', accionExterna: true,
    titulo: 'Guardar', texto: 'Tocá Guardar para registrar el día de ausencia.',
  },
  // ── Día 2: trabajo en base ──
  {
    id: 'g-base-dia', tab: 'horas', target: '[data-tour="hrs-dia"]',
    titulo: 'Día 2: trabajo en base', texto: 'Tocá el día siguiente (iluminado) para cargarlo.',
    onEnter: a => { a.cerrarDialogo?.() },
    avanzaAlTocar: true,
  },
  {
    id: 'g-base-turno', tab: 'horas', target: '[data-tour="dlg-turno"]',
    titulo: 'Trabajo en base', texto: 'Cargá la entrada y la salida. Si es turno noche, cargá el turno COMPLETO (ej. 19:00 → 07:00); no lo cortes en 00:00 — la app reparte las horas sola.',
    done: () => qs('[data-tour="dlg-turno"]')?.dataset.completo === '1',
    debounce: true, delayMs: 3000, // avanza 3 s tras el último cambio del horario (salida)
  },
  {
    id: 'g-base-lugar', tab: 'horas', target: '[data-tour="dlg-lugar-base"]',
    titulo: 'Lugar: Base', texto: 'Tocá Base.',
    avanzaAlTocar: true,
  },
  {
    id: 'g-base-viaje', tab: 'horas', target: '[data-tour="dlg-viaje-base"]',
    titulo: 'Viaje a base (+1 h)', texto: 'Si viajaste a la base, activá el +1 h (se suma aparte de las horas de trabajo).',
    avanzaAlTocar: true,
  },
  {
    id: 'g-base-obs', tab: 'horas', target: '[data-tour="dlg-obs"]',
    titulo: 'Observación', texto: 'Anotá una observación (ej: el pozo).',
    done: () => valDe('[data-tour="dlg-obs"] input').trim().length > 0,
    delayMs: 1500, debounce: true, // avanza recién tras 1,5 s sin tipear
  },
  {
    id: 'g-base-guardar', tab: 'horas', target: '[data-tour="dlg-guardar"]', accionExterna: true,
    titulo: 'Guardar', texto: 'Tocá Guardar para registrar el día en base.',
  },
  // ── Día 3: trabajo en campo ──
  {
    id: 'g-campo-dia', tab: 'horas', target: '[data-tour="hrs-dia"]',
    titulo: 'Día 3: trabajo en campo', texto: 'Tocá el día siguiente (iluminado) para cargarlo.',
    onEnter: a => { a.cerrarDialogo?.() },
    avanzaAlTocar: true,
  },
  {
    id: 'g-campo-turno', tab: 'horas', target: '[data-tour="dlg-turno"]',
    titulo: 'Trabajo en campo', texto: 'Cargá la entrada y la salida. Si es turno noche, cargá el turno COMPLETO (ej. 19:00 → 07:00); no lo cortes en 00:00 — la app reparte las horas sola.',
    done: () => qs('[data-tour="dlg-turno"]')?.dataset.completo === '1',
    debounce: true, delayMs: 3000, // avanza 3 s tras el último cambio del horario (salida)
  },
  {
    id: 'g-campo-lugar', tab: 'horas', target: '[data-tour="dlg-lugar-campo"]',
    titulo: 'Lugar: Campo', texto: 'Tocá Campo.',
    avanzaAlTocar: true,
  },
  {
    id: 'g-campo-pernocte', tab: 'horas', target: '[data-tour="dlg-pernocte"]',
    titulo: 'Pernocte', texto: 'Si dormiste afuera marcá Hotel o Trailer; si no, NO.',
    avanzaAlTocar: true,
  },
  {
    id: 'g-campo-slider', tab: 'horas', target: '[data-tour="dlg-slider"]',
    titulo: 'Viaje (slider)', texto: 'Deslizá los km de viaje: de a 100 km, de 100 a 500. Suma 1,5 h cada 100 km (aparte de las horas de trabajo). El máximo (500+) te deja cargar las horas a mano.',
    avanzaAlTocar: true, debounce: true, delayMs: 1500, // avanza 1,5 s tras el último movimiento
  },
  {
    // Sólo aparece si marcó viaje (>0 km). Opcional: avanza al tocar el toggle o solo a los 5 s.
    id: 'g-campo-maneja', tab: 'horas', target: '[data-tour="dlg-maneja"]',
    titulo: '¿Manejaste?', texto: 'Si manejaste vos hasta el lugar, activá "Manejó este día". Si no, dejalo apagado: sigue solo.',
    avanzaAlTocar: true, delayMs: 700, autoMs: 10000,
    skipIf: () => !document.querySelector('[data-tour="dlg-maneja"]'),
  },
  {
    id: 'g-campo-obs', tab: 'horas', target: '[data-tour="dlg-obs"]',
    titulo: 'Observación', texto: 'Anotá una observación (ej: el pozo).',
    done: () => valDe('[data-tour="dlg-obs"] input').trim().length > 0,
    delayMs: 1500, debounce: true, // avanza recién tras 1,5 s sin tipear
  },
  {
    id: 'g-campo-guardar', tab: 'horas', target: '[data-tour="dlg-guardar"]', accionExterna: true,
    titulo: 'Guardar', texto: 'Tocá Guardar para registrar el día en campo.',
  },
  // ── Copiar un día (pintar) ──
  // Bloqueante: sólo el día resaltado responde al click derecho / long-press (no se abren otros días).
  {
    id: 'g-paint-longpress', tab: 'horas', target: '[data-tour="hrs-dia"]', accionExterna: true,
    titulo: 'Copiar un día', texto: 'Para repetir un día ya cargado: hacé click derecho (o mantené pulsado en el celular) sobre el día resaltado.',
    onEnter: a => { a.cerrarDialogo?.() },
  },
  {
    id: 'g-paint-pintar', tab: 'horas', libre: true, accionExterna: true,
    titulo: 'Elegí dónde copiar', texto: 'Tocá o arrastrá el dedo sobre los días donde copiarlo (quedan resaltados). Tocá de nuevo para despintar.',
  },
  {
    // Libre: se puede despintar pero siempre queda ≥1 día pintado (paintDay lo asegura).
    id: 'g-paint-finalizar', tab: 'horas', target: '[data-tour="hrs-aplicar"]', libre: true, accionExterna: true,
    titulo: 'Aplicá la copia', texto: 'Tocá "Aplicar" para copiar ese día a los que pintaste.',
  },
  // ── Borrar pintando (limpiar los días de ejemplo) ──
  {
    id: 'g-del-menu', tab: 'horas', target: '[data-tour="hrs-menu"]', accionExterna: true,
    titulo: 'Borrar los de ejemplo', texto: 'Ahora limpiemos los días de ejemplo: abrí el menú ⋮ (arriba a la derecha).',
  },
  {
    id: 'g-del-item', tab: 'horas', target: '[data-tour="menu-borrar-dias"]', accionExterna: true,
    titulo: 'Borrar días', texto: 'Tocá "Borrar días (elegir)".',
  },
  {
    id: 'g-del-pintar', tab: 'horas', libre: true, accionExterna: true,
    titulo: 'Marcá los días', texto: 'Tocá o arrastrá el dedo sobre los días de ejemplo para marcarlos (quedan en rojo). Tocá de nuevo para desmarcar.',
  },
  {
    id: 'g-del-borrar', tab: 'horas', target: '[data-tour="hrs-borrar"]', libre: true, accionExterna: true,
    titulo: 'Confirmá el borrado', texto: 'Tocá "Borrar" y confirmá, para dejar tu planilla limpia.',
  },
  // ── Exportar (últimos pasos) ──
  {
    id: 'g-export', tab: 'horas', target: '[data-tour="hrs-export"]',
    titulo: 'Exportar a Excel', texto: 'Cuando tengas el mes cargado, tocá este botón para ver las opciones de exportación.',
    onEnter: a => { a.cerrarDialogo?.() },
    avanzaAlTocar: true,
  },
  {
    id: 'g-export-normal', tab: 'horas', target: '[data-tour="hrs-export-normal"]',
    titulo: 'Planilla normal', texto: 'Esta es la que vas a usar casi siempre: "Normal (planilla)" exporta la planilla del mes lista para enviar.',
  },
  {
    id: 'cierre',
    titulo: '¡Listo!', texto: 'Eso es todo. Tu respaldo en la nube se hace solo. Podés volver a ver este tutorial desde el menú ⋮.',
  },
]

// ─── Mini-tour de respaldo en la nube (para el modal de usuarios con nombre sin nube) ───
// Sólo 2 pasos: 1) nombre y apellido, 2) tocar Generar.
const PASOS_NUBE: Paso[] = [
  {
    id: 'cfg-nombre', tab: 'settings', target: '[data-tour="cfg-nombre"]',
    titulo: 'Tu nombre y apellido',
    texto: 'Colocá tu nombre y apellido: se usa en la planilla, en el Excel exportado y en el respaldo en la nube (es la llave del respaldo). Tocá Siguiente cuando esté.',
  },
  {
    id: 'cfg-respaldo', tab: 'settings', target: '[data-tour="cfg-respaldo"]',
    titulo: 'Generá tu código',
    texto: 'Tocá Generar: crea tu código de 6 dígitos y activa el respaldo. Anotá tu nombre + código.',
    done: () => valDe('[data-tour="cfg-respaldo"] input').replace(/\D/g, '').length === 6,
  },
]

interface OnboardingCtx {
  activo: boolean
  paso: Paso | null
  pasoIdx: number
  total: number
  start: (modo?: TourModo, opts?: { saltearConfig?: boolean }) => void
  next: () => void
  back: () => void
  skip: () => void
  registrar: (a: Partial<TourAcciones>) => void
}

const Ctx = createContext<OnboardingCtx | null>(null)

export function useOnboarding(): OnboardingCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useOnboarding fuera de OnboardingProvider')
  return c
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [activo, setActivo] = useState(false)
  const [pasoIdx, setPasoIdx] = useState(0)
  const acciones = useRef<TourAcciones>({})
  const pasosRef = useRef<Paso[]>(PASOS)
  const modoRef = useRef<TourModo>('full')

  const registrar = useCallback((a: Partial<TourAcciones>) => {
    acciones.current = { ...acciones.current, ...a }
  }, [])

  const entrar = useCallback((idx: number) => {
    const p = pasosRef.current[idx]
    if (!p) return
    if (p.tab) acciones.current.setTab?.(p.tab)
    // tras un tick para que cambie de pestaña/renderice el target
    setTimeout(() => p.onEnter?.(acciones.current), 70)
  }, [])

  const terminar = useCallback(() => {
    setActivo(false)
    // Sólo el tour completo marca el onboarding como hecho (el mini-tour de nube no).
    if (modoRef.current === 'full') {
      try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
      acciones.current.salirPrueba?.()  // borra la planilla de prueba y vuelve al período actual
    }
    acciones.current.cerrarDialogo?.()
  }, [])

  const irA = useCallback((from: number, dir: 1 | -1) => {
    const pasos = pasosRef.current
    let i = from + dir
    while (i >= 0 && i < pasos.length && pasos[i].skipIf?.()) i += dir
    if (i < 0) i = 0
    if (i >= pasos.length) { terminar(); return }
    setPasoIdx(i)
    entrar(i)
  }, [entrar, terminar])

  const start = useCallback((modo: TourModo = 'full', opts?: { saltearConfig?: boolean }) => {
    pasosRef.current = modo === 'cloud' ? PASOS_NUBE : PASOS
    modoRef.current = modo
    if (modo === 'full') { try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ } }
    let i = 0
    // Reinicio con todo configurado (nombre + código ya cargados/bloqueados): saltar la sección de
    // config y arrancar directo en la planilla (carga de días), que es lo único que falta mostrar.
    if (modo === 'full' && opts?.saltearConfig) {
      const idx = PASOS.findIndex(p => p.id === 'g-aus-dia')
      if (idx >= 0) i = idx
    }
    // Saltear pasos iniciales con skipIf (p.ej. nombre ya cargado en el mini-tour).
    while (i < pasosRef.current.length && pasosRef.current[i].skipIf?.()) i++
    // El tour completo corre en una "planilla de prueba" aislada (no toca los datos reales).
    if (modo === 'full') acciones.current.entrarPrueba?.()
    setPasoIdx(i)
    setActivo(true)
    entrar(i)
  }, [entrar])

  const next = useCallback(() => irA(pasoIdx, 1), [irA, pasoIdx])
  const back = useCallback(() => irA(pasoIdx, -1), [irA, pasoIdx])
  const skip = useCallback(() => terminar(), [terminar])

  const value = useMemo<OnboardingCtx>(() => ({
    activo,
    paso: activo ? pasosRef.current[pasoIdx] ?? null : null,
    pasoIdx,
    total: pasosRef.current.length,
    start, next, back, skip, registrar,
  }), [activo, pasoIdx, start, next, back, skip, registrar])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
