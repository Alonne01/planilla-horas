import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type TabId = 'horas' | 'analytics' | 'settings' | 'salary'

export interface TourAcciones {
  setTab?: (t: TabId) => void
  actualizarFeriados?: () => void | Promise<void>
  guardarConfig?: () => void
  abrirDiaTour?: (modo: 'ausencia' | 'trabajo') => void
  cerrarDialogo?: () => void
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
}

const STORAGE_KEY = 'planilla-onboarding-done'

export function onboardingHecho(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

function hoyKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const PASOS: Paso[] = [
  {
    id: 'bienvenida',
    titulo: '¡Bienvenido!',
    texto: 'Te muestro cómo configurar y usar la planilla en un minuto. Podés saltarlo cuando quieras.',
  },
  {
    id: 'cfg-nombre', tab: 'settings', target: '[data-tour="cfg-nombre"]',
    titulo: 'Tu nombre', texto: 'Cargá tu nombre. Aparece en la planilla exportada.',
  },
  {
    id: 'cfg-linea', tab: 'settings', target: '[data-tour="cfg-linea"]',
    titulo: 'Línea de trabajo', texto: 'Elegí tu línea de trabajo: afecta cómo se cuentan las horas.',
  },
  {
    id: 'cfg-diagrama', tab: 'settings', target: '[data-tour="cfg-diagrama"]',
    titulo: 'Diagrama', texto: 'Elegí tu diagrama de trabajo (días de campo y francos).',
  },
  {
    id: 'cfg-fecha', tab: 'settings', target: '[data-tour="cfg-fecha"]',
    titulo: 'Inicio del diagrama', texto: 'Elegí el día que subís al campo: marca el arranque del diagrama. 😉',
    skipIf: () => !document.querySelector('[data-tour="cfg-fecha"]'),
  },
  {
    id: 'cfg-feriados', tab: 'settings', target: '[data-tour="cfg-feriados"]',
    titulo: 'Feriados', texto: 'Actualizo los feriados nacionales para vos.',
    onEnter: a => { a.actualizarFeriados?.() },
  },
  {
    id: 'cfg-guardar', tab: 'settings', target: '[data-tour="cfg-guardar"]',
    titulo: 'Guardar', texto: 'Guardo tu configuración.',
    onEnter: a => { a.guardarConfig?.() },
  },
  {
    id: 'hrs-dia', tab: 'horas', target: `[data-daykey="${hoyKey()}"]`,
    titulo: 'Cargar un día', texto: 'Para cargar un día, tocalo (este queda iluminado de ejemplo).',
  },
  {
    id: 'dlg-ausencia', tab: 'horas', target: '[data-tour="dlg-ausencia"]',
    titulo: 'Si faltaste', texto: 'Si tuviste una ausencia, no cargues horario y tocá uno: Compensatorio, Ausencia o Falta.',
    onEnter: a => { a.abrirDiaTour?.('ausencia') },
  },
  {
    id: 'dlg-turno', tab: 'horas', target: '[data-tour="dlg-turno"]',
    titulo: 'Si trabajaste', texto: 'Si trabajaste, cargá la hora de entrada y de salida.',
  },
  {
    id: 'dlg-lugar', tab: 'horas', target: '[data-tour="dlg-lugar"]',
    titulo: 'Lugar de trabajo', texto: 'Indicá el lugar: Base o Campo.',
    onEnter: a => { a.abrirDiaTour?.('trabajo') },
  },
  {
    id: 'dlg-viaje', tab: 'horas', target: '[data-tour="dlg-viaje"]',
    titulo: 'Viaje y pernocte', texto: 'En Base sumás +1 h de viaje. En Campo deslizás los km (1,5 h cada 100) y marcás el pernocte si dormiste afuera.',
  },
  {
    id: 'dlg-obs', tab: 'horas', target: '[data-tour="dlg-obs"]',
    titulo: 'Observaciones', texto: 'Anotá el pozo o una observación del día.',
  },
  {
    id: 'hrs-pintar', tab: 'horas',
    titulo: 'Pintar días', texto: 'Mantené pulsado un día ya cargado para copiarlo a otros: después pintás los días destino arrastrando el dedo.',
    onEnter: a => { a.cerrarDialogo?.() },
  },
  {
    id: 'hrs-borrar', tab: 'horas', target: '[data-tour="hrs-menu"]',
    titulo: 'Borrar días', texto: 'Desde este menú elegís "Borrar días" y pintás (en rojo) los que querés eliminar.',
  },
  {
    id: 'hrs-export', tab: 'horas', target: '[data-tour="hrs-export"]',
    titulo: 'Exportar', texto: 'Cuando termines el período, exportás tu planilla con este botón.',
  },
  {
    id: 'cierre',
    titulo: '¡Listo!', texto: 'Eso es todo. Podés volver a ver este tutorial desde el menú ⋮.',
  },
]

interface OnboardingCtx {
  activo: boolean
  paso: Paso | null
  pasoIdx: number
  total: number
  start: () => void
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

  const registrar = useCallback((a: Partial<TourAcciones>) => {
    acciones.current = { ...acciones.current, ...a }
  }, [])

  const entrar = useCallback((idx: number) => {
    const p = PASOS[idx]
    if (!p) return
    if (p.tab) acciones.current.setTab?.(p.tab)
    // tras un tick para que cambie de pestaña/renderice el target
    setTimeout(() => p.onEnter?.(acciones.current), 70)
  }, [])

  const terminar = useCallback(() => {
    setActivo(false)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    acciones.current.cerrarDialogo?.()
  }, [])

  const irA = useCallback((from: number, dir: 1 | -1) => {
    let i = from + dir
    while (i >= 0 && i < PASOS.length && PASOS[i].skipIf?.()) i += dir
    if (i < 0) i = 0
    if (i >= PASOS.length) { terminar(); return }
    setPasoIdx(i)
    entrar(i)
  }, [entrar, terminar])

  const start = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setPasoIdx(0)
    setActivo(true)
    entrar(0)
  }, [entrar])

  const next = useCallback(() => irA(pasoIdx, 1), [irA, pasoIdx])
  const back = useCallback(() => irA(pasoIdx, -1), [irA, pasoIdx])
  const skip = useCallback(() => terminar(), [terminar])

  const value = useMemo<OnboardingCtx>(() => ({
    activo,
    paso: activo ? PASOS[pasoIdx] ?? null : null,
    pasoIdx,
    total: PASOS.length,
    start, next, back, skip, registrar,
  }), [activo, pasoIdx, start, next, back, skip, registrar])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
