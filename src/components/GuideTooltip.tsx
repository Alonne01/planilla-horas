import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useOnboarding } from '../onboarding/OnboardingContext'

// Circunferencia del anillo del timer del tutorial (r=15) para el dibujo progresivo.
const CIRC = 2 * Math.PI * 15

/**
 * Overlay del tour: un "spotlight" que OSCURECE y BLOQUEA toda la pantalla salvo el
 * rect del elemento resaltado (marco de 4 divs alrededor del hueco). El paso avanza solo
 * al completar la acción (`done`) o al tocar el elemento (`avanzaAlTocar`); los pasos
 * informativos llevan un botón "Siguiente". "Omitir" corta el tour en cualquier momento.
 */
export function GuideTooltip() {
  const { activo, paso, pasoIdx, total, next, skip } = useOnboarding()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [notFound, setNotFound] = useState(false)
  // Posición arrastrada de la tarjeta (se resetea por paso): permite correrla si tapa algo.
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  // Para ubicar la tarjeta sin tapar el target: alto real medido + re-render al cambiar el viewport visible.
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(180)
  const [, setVvTick] = useState(0)
  // Cuenta regresiva visible (barra) hasta avanzar: { dur, t0 } o null. La setean los efectos de debounce.
  const [cuenta, setCuenta] = useState<{ dur: number; t0: number } | null>(null)
  // "Omitir" aparece recién 1,5 s después de mostrarse la tarjeta del paso (evita saltarlo sin querer).
  const [mostrarOmitir, setMostrarOmitir] = useState(false)
  // Doble confirmación de "Omitir": al tocarlo pide confirmar y "Sí, salir" se habilita recién a los 5 s.
  const [confirmSalir, setConfirmSalir] = useState(false)
  const [segSalir, setSegSalir] = useState(5)

  // Sigue al target de forma CONTINUA (rAF): mide cada frame y actualiza el hueco sólo cuando cambia.
  // Así el spotlight queda SIEMPRE pegado al elemento aunque el diálogo entre animado (slide-in),
  // haga scroll o cambie de alto (p.ej. el aviso que aparece al cargar las horas). `scrollIntoView`
  // se llama una sola vez al encontrarlo. Si no aparece tras ~40 frames → "no encontrado" (Siguiente).
  useEffect(() => {
    if (!activo || !paso?.target) { setRect(null); setNotFound(false); return }
    const sel = paso.target
    let raf = 0, tries = 0, alive = true, scrolled = false
    let last: DOMRect | null = null
    const tick = () => {
      if (!alive) return
      const el = document.querySelector(sel) as HTMLElement | null
      if (el) {
        tries = 0
        if (!scrolled) { scrolled = true; el.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
        const r = el.getBoundingClientRect()
        if (!last || Math.abs(r.top - last.top) > 0.5 || Math.abs(r.left - last.left) > 0.5
          || Math.abs(r.width - last.width) > 0.5 || Math.abs(r.height - last.height) > 0.5) {
          last = r; setRect(r); setNotFound(false)
        }
      } else if (tries++ >= 40) {
        setRect(null); setNotFound(true); return
      }
      raf = requestAnimationFrame(tick)
    }
    // No reseteamos el rect a null: mantenemos el hueco anterior hasta encontrar el nuevo (sin parpadeo).
    setNotFound(false)
    raf = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [activo, paso])

  // Avance por COMPLETAR: pollea el predicado `done`; al cumplirse, avanza tras `delayMs` (p.ej.
  // 5 s en la observación, contados desde que empieza a escribir).
  // Con `paso.debounce` el delay se cuenta "sin input": cada tecla reinicia la cuenta y se avanza
  // recién tras `delayMs` ms sin tipear (p.ej. el nombre, para no saltar al primer carácter).
  useEffect(() => {
    if (!activo || !paso?.done) return
    const done = paso.done
    const delay = paso.delayMs ?? 0
    let avanzar = 0

    if (paso.debounce) {
      // Avanza tras `delay` ms SIN actividad. Reinicia con cada `input`/`change` (texto, select) y,
      // mientras se ARRASTRA un control (drum de la hora), NO cuenta con el dedo apretado: recién arranca
      // al soltar. Así no avanza a mitad de mover la hora, aunque se mueva despacio. El poll arma la
      // cuenta si el campo ya está completo sin tipear (p.ej. al reiniciar el tour con el nombre cargado).
      const sel = paso.target
      const dentro = (t: EventTarget | null) => {
        if (!sel) return true
        const el = document.querySelector(sel) as HTMLElement | null
        return !!(el && t instanceof Node && el.contains(t))
      }
      let interactuando = false
      const armar = () => {
        clearTimeout(avanzar); avanzar = 0
        if (!interactuando && done()) { avanzar = window.setTimeout(() => next(), delay); setCuenta({ dur: delay, t0: Date.now() }) }
        else setCuenta(null)
      }
      const onInput = (e: Event) => { if (dentro(e.target)) armar() }
      const onDown = (e: Event) => { if (dentro(e.target)) { interactuando = true; clearTimeout(avanzar); avanzar = 0; setCuenta(null) } }
      const onUp = () => { if (interactuando) { interactuando = false; armar() } }
      document.addEventListener('input', onInput, true)
      document.addEventListener('change', onInput, true)
      document.addEventListener('pointerdown', onDown, true)
      document.addEventListener('pointerup', onUp, true)
      document.addEventListener('pointercancel', onUp, true)
      const poll = window.setInterval(() => { if (!avanzar && !interactuando && done()) armar() }, 350)
      armar() // por si el campo ya venía completo al entrar al paso
      return () => {
        document.removeEventListener('input', onInput, true)
        document.removeEventListener('change', onInput, true)
        document.removeEventListener('pointerdown', onDown, true)
        document.removeEventListener('pointerup', onUp, true)
        document.removeEventListener('pointercancel', onUp, true)
        clearInterval(poll); clearTimeout(avanzar)
      }
    }

    // Sin debounce: una vez que `done` se cumple, se compromete a avanzar tras `delay` ms FIJOS (no se
    // reinicia aunque el usuario siga escribiendo). Si hay delay, muestra el anillo de cuenta (p.ej. los
    // 7 s del apellido, contados desde que empieza a escribirlo).
    const t = setInterval(() => {
      if (done()) {
        clearInterval(t)
        avanzar = window.setTimeout(() => next(), delay)
        if (delay > 0) setCuenta({ dur: delay, t0: Date.now() })
      }
    }, 350)
    return () => { clearInterval(t); clearTimeout(avanzar) }
  }, [activo, paso, next])

  // Avance por TOCAR el elemento resaltado. Ignora los toques de los primeros 400 ms (suele ser el
  // toque que venía del paso anterior) y avanza tras `delayMs`. Con `paso.debounce`, además, cada
  // movimiento (evento `input`, p.ej. arrastrar el slider) dentro del target reinicia la cuenta →
  // avanza `delayMs` tras el ÚLTIMO movimiento.
  useEffect(() => {
    if (!activo || !paso?.avanzaAlTocar || !paso.target) return
    const sel = paso.target
    const delay = paso.delayMs ?? 120
    const debounce = !!paso.debounce
    const activadoEn = Date.now()
    let avanzar = 0
    const dentro = (t: EventTarget | null) => {
      const el = document.querySelector(sel) as HTMLElement | null
      return !!(el && t instanceof Node && el.contains(t))
    }
    const programar = () => { clearTimeout(avanzar); avanzar = window.setTimeout(() => next(), delay); if (debounce) setCuenta({ dur: delay, t0: Date.now() }) }
    function onDown(e: PointerEvent) {
      if (Date.now() - activadoEn < 400) return
      if (dentro(e.target)) programar()
    }
    function onInput(e: Event) {
      if (Date.now() - activadoEn < 400) return
      if (dentro(e.target)) programar()
    }
    document.addEventListener('pointerdown', onDown, true)
    if (debounce) document.addEventListener('input', onInput, true)
    // Limpiar el timeout pendiente al cambiar de paso evita un avance "fantasma" (p.ej. si autoMs
    // disparó primero en la carrera toggle/5 s).
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('input', onInput, true)
      clearTimeout(avanzar)
    }
  }, [activo, paso, next])

  // Auto-avance tras `autoMs` aunque no haya interacción (campos opcionales como "¿Manejaste?").
  useEffect(() => {
    if (!activo || !paso?.autoMs) return
    const t = window.setTimeout(() => next(), paso.autoMs)
    return () => clearTimeout(t)
  }, [activo, paso, next])

  // Al cambiar de paso, la tarjeta vuelve a su posición por defecto.
  useEffect(() => { setDrag({ x: 0, y: 0 }); setCuenta(null) }, [paso?.id])

  // "Omitir" aparece 1,5 s después de que se muestra el paso (para que el usuario lo lea primero).
  useEffect(() => {
    setMostrarOmitir(false)
    const t = window.setTimeout(() => setMostrarOmitir(true), 1500)
    return () => clearTimeout(t)
  }, [paso?.id])

  // Doble confirmación de Omitir: la cuenta de 5 s para habilitar "Sí, salir" arranca al abrirla.
  useEffect(() => {
    if (!confirmSalir) return
    setSegSalir(5)
    const t = window.setInterval(() => setSegSalir(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [confirmSalir])
  // Al cambiar de paso, se cierra cualquier confirmación de salida abierta.
  useEffect(() => { setConfirmSalir(false) }, [paso?.id])

  // Paso DEMO del círculo: muestra el anillo llenándose (iluminado) EN LOOP. NO auto-avanza: el
  // usuario pasa con el botón "Siguiente" (sólo es una muestra del mecanismo).
  useEffect(() => {
    if (!activo || !paso?.demoAnillo) return
    const dur = 3500
    const fill = () => setCuenta({ dur, t0: Date.now() })
    fill()
    const iv = window.setInterval(fill, dur + 600)
    return () => clearInterval(iv)
  }, [activo, paso])

  // Medir el alto real de la tarjeta (cambia con el texto de cada paso, y al aparecer el anillo demo)
  // para posicionarla sin que el botón "Siguiente" quede fuera de pantalla.
  useEffect(() => { if (cardRef.current) setCardH(cardRef.current.offsetHeight) }, [paso?.id, paso?.texto, !!cuenta, confirmSalir])

  // Reposicionar al abrir/cerrar el teclado (cambia el viewport visible).
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onVV = () => setVvTick(t => t + 1)
    vv.addEventListener('resize', onVV)
    vv.addEventListener('scroll', onVV)
    return () => { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV) }
  }, [])

  if (!activo || !paso) return null

  const esUltimo = pasoIdx === total - 1
  // Sin acción gatillo, o con un target que no existe → mostrar "Siguiente" (nunca quedar trabado).
  // "Siguiente" si el target no existe (respaldo). Si no, mostrarlo salvo en pasos por acción
  // externa (guardar) — esos avanzan SOLO al guardar.
  const esInfo = (!!paso.target && notFound)
    || (!paso.accionExterna && ((!paso.done && !paso.avanzaAlTocar) || !!paso.libre))
  // Pasos "libre": no oscurecen ni bloquean (pintar/borrar y selector de hora necesitan interacción
  // libre); el avance lo dispara el estado (HorasTrabajo → onb.next()), con "Siguiente" como respaldo.
  const bloquea = !paso.libre

  // Posición vertical de la tarjeta: relativa al target y dentro del viewport VISIBLE (respeta el
  // teclado vía VisualViewport), sin tapar nunca el rect resaltado.
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  const visTop = vv?.offsetTop ?? 0
  const visBottom = visTop + (vv?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800))
  const gapCard = 12
  const marginCard = 8
  let cardTop: number
  if (!rect) {
    cardTop = visBottom - cardH - marginCard                            // sin target: al pie del área visible
  } else if (rect.bottom + gapCard + cardH <= visBottom - marginCard) {
    cardTop = rect.bottom + gapCard                                      // debajo del target
  } else if (rect.top - gapCard - cardH >= visTop + marginCard) {
    cardTop = rect.top - gapCard - cardH                                 // arriba del target
  } else {
    // No entra ni arriba ni abajo: el lado con más espacio.
    cardTop = (rect.top - visTop) > (visBottom - rect.bottom) ? visTop + marginCard : visBottom - cardH - marginCard
  }
  cardTop = Math.max(visTop + marginCard, Math.min(cardTop, visBottom - cardH - marginCard))

  const pad = 6
  const hole = rect
    ? {
        left: Math.max(0, rect.left - pad),
        top: Math.max(0, rect.top - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null

  // Arrastre de la tarjeta (por el grip), para apartarla cuando tapa el calendario u otra cosa.
  function onGripDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = { px: e.clientX, py: e.clientY, x: drag.x, y: drag.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onGripMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = dragStart.current
    if (!s) return
    setDrag({ x: s.x + (e.clientX - s.px), y: s.y + (e.clientY - s.py) })
  }
  function onGripUp() { dragStart.current = null }

  return (
    // Contenedor pointer-events-none: el hueco deja pasar los toques al elemento resaltado.
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Backdrop oscuro que BLOQUEA (sólo si el paso NO es libre), con un hueco sobre el target. */}
      {bloquea && (hole ? (
        <>
          <div className="pointer-events-auto absolute left-0 right-0 top-0 bg-black/60" style={{ height: hole.top }} />
          <div className="pointer-events-auto absolute left-0 bg-black/60" style={{ top: hole.top, width: hole.left, height: hole.height }} />
          <div className="pointer-events-auto absolute right-0 bg-black/60" style={{ top: hole.top, left: hole.left + hole.width, height: hole.height }} />
          <div className="pointer-events-auto absolute left-0 right-0 bottom-0 bg-black/60" style={{ top: hole.top + hole.height }} />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-black/60 animate-[backdrop-fade-in_200ms_ease_both]" />
      ))}

      {/* Glow sobre el target (no bloquea): sigue al hueco frame a frame. */}
      {hole && (
        <div
          className="tour-glow pointer-events-none absolute rounded-xl"
          style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
        />
      )}

      {/* Tarjeta guía. `key` por paso → re-anima la entrada en cada paso. Arrastrable por el grip
          superior, por si tapa algo que el usuario necesita ver o tocar. */}
      <div
        key={paso.id}
        ref={cardRef}
        className="pointer-events-auto fixed inset-x-3 mx-auto max-w-sm max-h-[82vh] overflow-y-auto rounded-2xl border border-sky-500/30 bg-slate-800/85 p-3 pt-4 shadow-2xl shadow-black/50 backdrop-blur-sm animate-[gate-rise_240ms_ease_both] transition-[top] duration-200 ease-out"
        style={{
          top: cardTop,
          ...(drag.x || drag.y ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : null),
        }}
      >
        {/* Grip para mover la tarjeta si tapa algo */}
        <div
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          className="absolute inset-x-0 top-0 flex h-4 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          aria-hidden
        >
          <div className="h-1 w-8 rounded-full bg-slate-600" />
        </div>

        {paso.titulo && <p className="text-sm font-bold text-sky-300">{paso.titulo}</p>}
        <p className="mt-1 text-sm leading-snug text-slate-200">{paso.texto}</p>

        {/* Anillo grande ILUMINADO del paso demo: enseña visualmente cómo se llena para avanzar. */}
        {paso.demoAnillo && cuenta && (
          <div className="mt-2 flex justify-center">
            <svg key={cuenta.t0} viewBox="0 0 36 36" className="h-11 w-11 -rotate-90" style={{ filter: 'drop-shadow(0 0 7px rgb(56 189 248))' }}>
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="4" />
              <circle
                cx="18" cy="18" r="15" fill="none" stroke="rgb(56 189 248)" strokeWidth="4" strokeLinecap="round"
                style={{ strokeDasharray: CIRC, strokeDashoffset: CIRC, animation: `tour-ring ${cuenta.dur}ms linear forwards` }}
              />
            </svg>
          </div>
        )}

        {cuenta && !paso.demoAnillo ? (
          <p className="mt-1.5 text-center text-[11px] font-semibold text-sky-300">Esperá a que se llene el círculo ↻ para pasar al siguiente paso</p>
        ) : !esInfo ? (
          <p className="mt-1.5 text-[11px] font-medium text-sky-400/90">Hacelo para seguir →</p>
        ) : null}

        {confirmSalir ? (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-950/40 p-2.5 animate-[gate-rise_180ms_ease_both]">
            <p className="text-xs font-bold text-rose-200">¿Querés salir del tutorial?</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-300">Te vas a perder los pasos que faltan. Podés volver a verlo cuando quieras desde el menú ⋮.</p>
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmSalir(false)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 active:bg-slate-600">
                Seguir en el tutorial
              </button>
              <button
                onClick={skip}
                disabled={segSalir > 0}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${segSalir > 0 ? 'cursor-not-allowed bg-rose-900/50 text-rose-200/60' : 'bg-rose-600 text-white active:bg-rose-700'}`}
              >
                {segSalir > 0 ? `Sí, salir (${segSalir})` : 'Sí, salir'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[11px] text-slate-500">{pasoIdx + 1}/{total}</span>
            <div className="flex-1" />
            <button
              onClick={() => setConfirmSalir(true)}
              className={`px-2 py-1.5 text-xs font-medium text-slate-400 transition-opacity duration-300 active:text-slate-200 ${mostrarOmitir ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              Omitir
            </button>
            {esInfo && (
              <button onClick={next} className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-bold text-white active:bg-sky-700">
                {esUltimo ? 'Terminar' : 'Siguiente'}
              </button>
            )}
          </div>
        )}

        {/* Timer: anillo pequeño en la esquina que se va "abriendo" hasta avanzar (se reinicia con cada cambio/movimiento). */}
        {cuenta && !paso.demoAnillo && (
          <svg key={cuenta.t0} viewBox="0 0 36 36" className="pointer-events-none absolute right-2 top-2 h-5 w-5 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="5" />
            <circle
              cx="18" cy="18" r="15" fill="none" stroke="rgb(56 189 248)" strokeWidth="5" strokeLinecap="round"
              style={{ strokeDasharray: CIRC, strokeDashoffset: CIRC, animation: `tour-ring ${cuenta.dur}ms linear forwards` }}
            />
          </svg>
        )}
      </div>
    </div>
  )
}
