// Comparador PURO recibo ↔ estimación del período (calcularSueldo), portado de
// EquipTrack utils/recibo/ReciboComparador.kt y extendido al CCT 644/12.
// Toda la aritmética vive acá (determinística, sin IA).
//
// Regla central (igual que el Kotlin): separar TARIFA (monto ÷ unidades del recibo
// vs tarifa del convenio) de CANTIDAD (unidades del recibo vs las de la planilla) —
// así "la hora está bien paga pero te contaron 7 en vez de 20" sale como hallazgo
// inequívoco con su monto faltante.

import type { LineItem, SalaryEstimate } from './calculo-salarial'
import { nombreConcepto, type ReciboParseado } from './recibo-parser'

export type Severidad = 'OK' | 'TOLERANCIA' | 'REVISAR' | 'FALTANTE' | 'INFO'
export type Veredicto = 'OK' | 'REVISAR' | 'PAGO_INCOMPLETO'

export interface Hallazgo {
  codigo: string
  concepto: string
  esperado: number | null
  pagado: number | null
  /** pagado − esperado (negativo = te pagaron menos). */
  dif: number | null
  unidadesEsperadas?: number | null
  unidadesPagadas?: number | null
  severidad: Severidad
  nota?: string
}

export interface AnalisisRecibo {
  veredicto: Veredicto
  hallazgos: Hallazgo[]
  /** Suma de lo que falta a favor del empleado (bruto, conceptos de haberes). */
  totalFaltante: number
  /** Resumen textual determinístico (siempre disponible, sin IA). */
  resumenLocal: string
}

const TOL_EXACTO = 500          // $ de tolerancia en conceptos exactos
const TOL_TARIFA = 0.005        // ±0,5% en tarifa por hora
const TOL_UNIDADES_HORAS = 0.5  // media hora
const TOL_UNIDADES_VIANDAS = 1  // ±1 unidad (conteo operativo)
const TOL_ESTIMATIVO = 0.15     // ±15% (desarraigo / presentismo 644: estimativos)

/** Conceptos de haberes cuyo faltante suma al reclamo (excluye retenciones e informativos). */
const HABERES_637 = new Set([
  '3001', '3010', '3050', '3060', '3065', '3130', '3150', '3155', '3172', '3373', '3374',
  '40310', '40312', '40316', '42210', '42220',
])
const HABERES_644 = new Set([
  '2', '30', '18', '24', '50', '100', '102', '300', '150', '170', '171', '191',
  '40010', '40012', '40016', '42210', '42220',
])

/** Conceptos que se parsean pero NO se comparan (se cancelan o son del empleador). */
const IGNORAR_637 = new Set(['3990', '3991', '99999', '85000', '85100', '85200', '85400'])
const IGNORAR_644 = new Set(['99999'])

interface Ctx {
  recibo: ReciboParseado
  est: SalaryEstimate
  esperados: Map<string, LineItem>
  hallazgos: Hallazgo[]
  /** Códigos del recibo ya tratados (para el barrido final de "no contemplados"). */
  consumidos: Set<string>
  haberes: Set<string>
}

export function compararRecibo(recibo: ReciboParseado, est: SalaryEstimate): AnalisisRecibo {
  const esperados = new Map<string, LineItem>()
  for (const it of [...est.fijoItems, ...est.variableItems, ...est.noRemItems, ...est.retencionItems]) {
    if (!esperados.has(it.codigo)) esperados.set(it.codigo, it)
  }
  const ctx: Ctx = {
    recibo, est, esperados,
    hallazgos: [],
    consumidos: new Set(),
    haberes: new Set(est.convenio === 'CCT_644_12' ? HABERES_644 : HABERES_637),
  }

  if (est.convenio === 'CCT_644_12') comparar644(ctx)
  else comparar637(ctx)

  // ── Neto informativo ─────────────────────────────────────────────────────
  if (recibo.totalNeto != null) {
    ctx.hallazgos.push({
      codigo: 'NETO', concepto: 'Total neto',
      esperado: est.netoEstimado, pagado: recibo.totalNeto, dif: recibo.totalNeto - est.netoEstimado,
      severidad: 'INFO',
      nota: 'El estimado de la app es aproximado: usar los hallazgos por concepto, no esta diferencia.',
    })
  }

  // ── Barrido final: conceptos del recibo sin tratar ───────────────────────
  barrerNoContemplados(ctx)

  const totalFaltante = ctx.hallazgos
    .filter(h => ctx.haberes.has(h.codigo) && (h.severidad === 'FALTANTE' || h.severidad === 'REVISAR'))
    .reduce((s, h) => s + (h.dif != null && h.dif < 0 ? -h.dif : 0), 0)

  const veredicto: Veredicto = ctx.hallazgos.some(h => h.severidad === 'FALTANTE')
    ? 'PAGO_INCOMPLETO'
    : ctx.hallazgos.some(h => h.severidad === 'REVISAR') ? 'REVISAR' : 'OK'

  return {
    veredicto,
    hallazgos: ctx.hallazgos,
    totalFaltante,
    resumenLocal: resumenLocal(veredicto, ctx.hallazgos, totalFaltante),
  }
}

// ── CCT 637/11 ────────────────────────────────────────────────────────────────

function comparar637(ctx: Ctx): void {
  const { est } = ctx
  const hb = est.horaBase

  // Exactos: fijos + no-rem fijos.
  for (const cod of ['3001', '3010', '3050', '3060', '3065', '42210', '42220']) {
    compararExacto(ctx, cod, esperadoMonto(ctx, cod))
  }

  // Horas: tarifa vs cantidad por separado.
  compararHoras(ctx, '3130', 'Horas Viaje', hb * 0.44105, est.totalViaje)
  compararHoras(ctx, '3150', 'Extras 50%', hb * 1.5, est.totalExtra50)
  compararHoras(ctx, '3155', 'Extras 100%', hb * 2.0, est.totalExtra100)

  // Actas a cuenta (3373/3374): tramo vigente + detección de ratio común.
  const ratios: number[] = []
  for (const cod of ['3373', '3374']) {
    const exp = esperadoMonto(ctx, cod)
    if (exp == null || exp <= 0) continue
    ctx.consumidos.add(cod)
    const pag = monto(ctx, cod)
    const nombre = nombreConcepto('CCT_637_11', cod)
    if (pag == null) {
      ctx.hallazgos.push({ codigo: cod, concepto: nombre, esperado: exp, pagado: null, dif: -exp, severidad: 'FALTANTE', nota: 'No figura en el recibo.' })
      continue
    }
    const ratio = pag / exp
    ratios.push(ratio)
    if (ratio >= 0.995 && ratio <= 1.005) {
      ctx.hallazgos.push({ codigo: cod, concepto: nombre, esperado: exp, pagado: pag, dif: pag - exp, severidad: 'OK' })
    } else {
      ctx.hallazgos.push({
        codigo: cod, concepto: nombre, esperado: exp, pagado: pag, dif: pag - exp,
        severidad: pag < exp ? 'FALTANTE' : 'REVISAR',
        nota: `Pagada al ${pct(ratio)} del tramo vigente.`,
      })
    }
  }
  if (ratios.length === 2 && Math.abs(ratios[0] - ratios[1]) < 0.002 && (ratios[0] < 0.995 || ratios[0] > 1.005)) {
    const i = ctx.hallazgos.map(h => h.codigo).lastIndexOf('3374')
    if (i >= 0) {
      ctx.hallazgos[i] = {
        ...ctx.hallazgos[i],
        nota: `${ctx.hallazgos[i].nota ?? ''} Ambas actas al MISMO ratio (${pct(ratios[0])}): patrón de prorrateo o absorción — preguntar a RRHH el criterio.`.trim(),
      }
    }
  }

  // Desarraigo (3172): estimativo con tolerancia amplia.
  compararEstimativo(ctx, '3172', esperadoMonto(ctx, '3172'),
    'Estimado calibrado por día de campo; RRHH liquida el exacto.')

  // Viandas / desayunos: cantidades con tolerancia ±1.
  compararUnidadesConteo(ctx, '40310', est.diasTrabajados)
  compararUnidadesConteo(ctx, '40312', unidadesDeConcepto(ctx.esperados.get('40312')?.concepto))
  compararUnidadesConteo(ctx, '40316', unidadesDeConcepto(ctx.esperados.get('40316')?.concepto))

  // Vianda IG = Ganancias ÷ 2 (regla al centavo, sobre montos del RECIBO).
  const gananciasRecibo = monto(ctx, '90000')
  const viandaIg = monto(ctx, '42100')
  if (gananciasRecibo != null && viandaIg != null) {
    ctx.consumidos.add('42100')
    const exp = gananciasRecibo / 2
    ctx.hallazgos.push(Math.abs(viandaIg - exp) <= 1
      ? { codigo: '42100', concepto: 'Vianda complementaria IG', esperado: exp, pagado: viandaIg, dif: viandaIg - exp, severidad: 'OK', nota: '= Ganancias ÷ 2, al centavo.' }
      : { codigo: '42100', concepto: 'Vianda complementaria IG', esperado: exp, pagado: viandaIg, dif: viandaIg - exp, severidad: 'REVISAR', nota: 'Debería ser exactamente Ganancias ÷ 2.' })
  }

  // Retenciones: informativas o verificadas sobre los montos del propio recibo.
  infoGanancias(ctx, 'La app solo la estima; el valor real lo liquida RRHH (la mitad vuelve como Vianda IG).')
  infoJubilacion(ctx)
  const baseSindical = ['3001', '3010', '3050', '3060', '3065', '3373', '3374', '3130', '3150', '3155']
    .reduce((s, c) => s + (monto(ctx, c) ?? 0), 0)
  compararRetencionSobreRecibo(ctx, '20130', 'Cuota Sindical 2,73%', baseSindical * 0.0273)
  compararRetencionSobreRecibo(ctx, '20131', 'Mutual PJ 4,09%', baseSindical * 0.0409)
}

// ── CCT 644/12 ────────────────────────────────────────────────────────────────

function comparar644(ctx: Ctx): void {
  const { est } = ctx
  const hb = est.horaBase

  // Exactos: básico, antigüedad, turno, zona, bono, torre/campo, vianda fija, VM.
  for (const cod of ['2', '30', '18', '24', '100', '102', '42210', '42220']) {
    compararExacto(ctx, cod, esperadoMonto(ctx, cod))
  }

  // Presentismo 6% (300): estimativo — depende de que TODAS las variables coincidan.
  compararEstimativo(ctx, '300', esperadoMonto(ctx, '300'),
    'Estimativo: es 6% de todo lo remunerativo; cierra solo si las variables coinciden.')

  // Horas: tarifa vs cantidad. La hora de viaje 644 no sale del valor hora extra,
  // se deriva del propio estimado (monto ÷ horas de la planilla).
  const itemViaje = ctx.esperados.get('150')
  const tarifaViaje = itemViaje != null && est.totalViaje > 0 ? itemViaje.monto / est.totalViaje : null
  compararHoras(ctx, '150', 'Horas Viaje', tarifaViaje, est.totalViaje)
  compararHoras(ctx, '170', 'Extras 50%', hb * 1.5, est.totalExtra50)
  compararHoras(ctx, '171', 'Extras 100%', hb * 2.0, est.totalExtra100)

  // Desarraigo (191): estimativo con tolerancia amplia.
  compararEstimativo(ctx, '191', esperadoMonto(ctx, '191'),
    'Estimado por pernocte en trailer; RRHH liquida el exacto.')

  // Viandas / desayunos: cantidades con tolerancia ±1.
  compararUnidadesConteo(ctx, '40010', est.diasTrabajados)
  compararUnidadesConteo(ctx, '40012', est.diasCampo > 0 ? est.diasCampo * 2 : null)
  compararUnidadesConteo(ctx, '40016', est.diasTrabajados * 2)

  // Vianda complementaria IG (42200): informativa (la app no la modela en el 644).
  const viandaIg = monto(ctx, '42200')
  if (viandaIg != null) {
    ctx.consumidos.add('42200')
    ctx.hallazgos.push({
      codigo: '42200', concepto: nombreConcepto('CCT_644_12', '42200'),
      esperado: null, pagado: viandaIg, dif: null, severidad: 'INFO',
      nota: 'La liquida RRHH junto con Ganancias; la app no la estima para este convenio.',
    })
  }

  infoGanancias(ctx, 'La app no estima Ganancias para este convenio; el valor lo liquida RRHH.')
  infoJubilacion(ctx)
}

// ── Comparaciones compartidas ─────────────────────────────────────────────────

function esperadoMonto(ctx: Ctx, cod: string): number | null {
  return ctx.esperados.get(cod)?.monto ?? null
}

function monto(ctx: Ctx, cod: string): number | null {
  return ctx.recibo.conceptos[cod]?.monto ?? null
}

function nombre(ctx: Ctx, cod: string): string {
  return nombreConcepto(ctx.est.convenio, cod)
}

/** Concepto exacto (±$500). Sin ítem esperado (o esperado 0 y ausente) no opina. */
function compararExacto(ctx: Ctx, cod: string, exp: number | null, concepto?: string): void {
  if (exp == null) return
  ctx.consumidos.add(cod)
  const pag = monto(ctx, cod)
  const nom = concepto ?? nombre(ctx, cod)
  if (pag == null) {
    // Esperado ~0 y ausente del recibo: no es un faltante real (ej. antigüedad 0 años).
    if (exp > TOL_EXACTO) {
      ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: null, dif: -exp, severidad: 'FALTANTE', nota: 'No figura en el recibo.' })
    }
    return
  }
  const dif = pag - exp
  if (Math.abs(dif) <= TOL_EXACTO) {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif, severidad: 'OK' })
  } else if (pag < exp) {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif, severidad: 'FALTANTE' })
  } else {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif, severidad: 'TOLERANCIA', nota: 'Pagado por encima del estimado.' })
  }
}

/** Concepto estimativo (±15%): desarraigo / presentismo 644. */
function compararEstimativo(ctx: Ctx, cod: string, exp: number | null, notaBanda: string): void {
  if (exp == null || exp <= 0) return
  ctx.consumidos.add(cod)
  const pag = monto(ctx, cod)
  const nom = nombre(ctx, cod)
  if (pag == null) {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: null, dif: -exp, severidad: 'FALTANTE', nota: 'No figura en el recibo.' })
    return
  }
  const dif = pag - exp
  if (Math.abs(dif) / exp <= TOL_ESTIMATIVO) {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif, severidad: 'TOLERANCIA', nota: `Dentro de la banda del estimado. ${notaBanda}` })
  } else {
    ctx.hallazgos.push({
      codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif,
      severidad: pag < exp ? 'REVISAR' : 'TOLERANCIA',
      nota: `${pct(pag / exp)} del esperado — muy fuera de banda, revisar con RRHH. ${notaBanda}`,
    })
  }
}

/** Horas: 1) TARIFA (monto ÷ unidades del recibo vs convenio ±0,5%), 2) CANTIDAD
 *  (unidades del recibo vs horas de la planilla; faltante = difHs × tarifa). */
function compararHoras(ctx: Ctx, cod: string, nom: string, tarifa: number | null, unidadesPlanilla: number): void {
  ctx.consumidos.add(cod)
  const c = ctx.recibo.conceptos[cod]
  const exp = tarifa != null ? unidadesPlanilla * tarifa : null
  if (c == null) {
    if (unidadesPlanilla > 0) {
      ctx.hallazgos.push({
        codigo: cod, concepto: nom, esperado: exp, pagado: null, dif: exp != null ? -exp : null,
        unidadesEsperadas: unidadesPlanilla, unidadesPagadas: null, severidad: 'FALTANTE',
        nota: `No figura en el recibo y la planilla tiene ${fmtHs(unidadesPlanilla)} hs.`,
      })
    }
    return
  }
  const pag = c.monto
  const uds = c.unidades
  if (uds != null && uds > 0) {
    // 1) Tarifa: monto ÷ unidades del recibo vs tarifa del convenio.
    const tarifaRecibo = pag / uds
    if (tarifa != null && Math.abs(tarifaRecibo - tarifa) / tarifa > TOL_TARIFA) {
      ctx.hallazgos.push({
        codigo: cod, concepto: `${nom} — tarifa`, esperado: tarifa, pagado: tarifaRecibo, dif: tarifaRecibo - tarifa,
        unidadesEsperadas: unidadesPlanilla, unidadesPagadas: uds, severidad: 'REVISAR',
        nota: `La tarifa por hora del recibo (${fmt(tarifaRecibo)}) no coincide con el convenio (${fmt(tarifa)}).`,
      })
    }
    // 2) Cantidad: unidades del recibo vs planilla.
    const tarifaRef = tarifa ?? tarifaRecibo
    const difHs = unidadesPlanilla - uds
    if (Math.abs(difHs) <= TOL_UNIDADES_HORAS) {
      ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif: exp != null ? pag - exp : null, unidadesEsperadas: unidadesPlanilla, unidadesPagadas: uds, severidad: 'OK' })
    } else if (difHs > 0) {
      ctx.hallazgos.push({
        codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif: -(difHs * tarifaRef),
        unidadesEsperadas: unidadesPlanilla, unidadesPagadas: uds, severidad: 'FALTANTE',
        nota: `Liquidaron ${fmtHs(uds)} hs y la planilla tiene ${fmtHs(unidadesPlanilla)} hs: faltan ${fmtHs(difHs)} hs = ${fmt(difHs * tarifaRef)}.`,
      })
    } else {
      ctx.hallazgos.push({
        codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif: exp != null ? pag - exp : null,
        unidadesEsperadas: unidadesPlanilla, unidadesPagadas: uds, severidad: 'TOLERANCIA',
        nota: `Liquidaron más horas que la planilla (${fmtHs(uds)} vs ${fmtHs(unidadesPlanilla)}).`,
      })
    }
  } else {
    // Sin unidades legibles: comparación por monto.
    if (exp == null) {
      ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: null, pagado: pag, dif: null, unidadesEsperadas: unidadesPlanilla, unidadesPagadas: null, severidad: 'TOLERANCIA', nota: 'Sin unidades legibles y sin horas en la planilla: verificar a mano.' })
    } else if (Math.abs(pag - exp) <= TOL_EXACTO) {
      ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif: pag - exp, unidadesEsperadas: unidadesPlanilla, unidadesPagadas: null, severidad: 'OK' })
    } else if (pag < exp) {
      ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif: pag - exp, unidadesEsperadas: unidadesPlanilla, unidadesPagadas: null, severidad: 'REVISAR', nota: 'Sin unidades legibles en el recibo; diferencia por monto.' })
    } else {
      ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: exp, pagado: pag, dif: pag - exp, unidadesEsperadas: unidadesPlanilla, unidadesPagadas: null, severidad: 'TOLERANCIA' })
    }
  }
}

/** Viandas/desayunos: compara CANTIDADES (±1 unidad, conteo operativo estimado). */
function compararUnidadesConteo(ctx: Ctx, cod: string, unidadesEsperadas: number | null): void {
  if (unidadesEsperadas == null || unidadesEsperadas <= 0) return
  ctx.consumidos.add(cod)
  const c = ctx.recibo.conceptos[cod]
  const nom = nombre(ctx, cod)
  if (c == null) {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: null, pagado: null, dif: null, unidadesEsperadas, unidadesPagadas: null, severidad: 'REVISAR', nota: 'No figura en el recibo.' })
    return
  }
  const uds = c.unidades
  if (uds == null) return
  const tarifaUnitaria = uds > 0 ? c.monto / uds : 0
  const difUds = unidadesEsperadas - uds
  if (Math.abs(difUds) <= TOL_UNIDADES_VIANDAS) {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: unidadesEsperadas * tarifaUnitaria, pagado: c.monto, dif: null, unidadesEsperadas, unidadesPagadas: uds, severidad: 'OK' })
  } else if (difUds > 0) {
    ctx.hallazgos.push({
      codigo: cod, concepto: nom, esperado: unidadesEsperadas * tarifaUnitaria, pagado: c.monto, dif: -(difUds * tarifaUnitaria),
      unidadesEsperadas, unidadesPagadas: uds, severidad: 'REVISAR',
      nota: `Liquidaron ${Math.round(uds)} y el conteo del período da ~${Math.round(unidadesEsperadas)}: faltan ${Math.round(difUds)} uds = ${fmt(difUds * tarifaUnitaria)} (conteo operativo, estimado).`,
    })
  } else {
    ctx.hallazgos.push({ codigo: cod, concepto: nom, esperado: unidadesEsperadas * tarifaUnitaria, pagado: c.monto, dif: null, unidadesEsperadas, unidadesPagadas: uds, severidad: 'TOLERANCIA', nota: 'Liquidaron más unidades que el conteo estimado.' })
  }
}

/** Retención verificada con % fijo sobre la base del PROPIO recibo (637: sindical/mutual). */
function compararRetencionSobreRecibo(ctx: Ctx, cod: string, nom: string, esperadoSobreRecibo: number): void {
  const pag = monto(ctx, cod)
  if (pag == null) return
  ctx.consumidos.add(cod)
  const dif = pag - esperadoSobreRecibo
  ctx.hallazgos.push(Math.abs(dif) <= TOL_EXACTO
    ? { codigo: cod, concepto: nom, esperado: esperadoSobreRecibo, pagado: pag, dif, severidad: 'OK', nota: 'Verificada sobre los montos del propio recibo.' }
    : { codigo: cod, concepto: nom, esperado: esperadoSobreRecibo, pagado: pag, dif, severidad: 'REVISAR', nota: 'No cierra contra la base (fijos + viaje + extras) del propio recibo.' })
}

function infoGanancias(ctx: Ctx, nota: string): void {
  const pag = monto(ctx, '90000')
  if (pag == null) return
  ctx.consumidos.add('90000')
  ctx.hallazgos.push({ codigo: '90000', concepto: 'Ret. Imp. Ganancias', esperado: esperadoMonto(ctx, '90000'), pagado: pag, dif: null, severidad: 'INFO', nota })
}

function infoJubilacion(ctx: Ctx): void {
  const jub = monto(ctx, '20000')
  if (jub == null) return
  ctx.consumidos.add('20000')
  ctx.hallazgos.push({
    codigo: '20000', concepto: 'Jubilación 11%', esperado: esperadoMonto(ctx, '20000'), pagado: jub, dif: null,
    severidad: 'INFO',
    nota: `Base imponible del recibo: ${fmt(jub / 0.11)} (tope ANSES del mes; sube por movilidad).`,
  })
}

/** Barrido final: conceptos del recibo no tratados. Matchea PERS-A/PERS-R por nombre;
 *  lo que queda sin par es un "concepto no contemplado" (informativo). */
function barrerNoContemplados(ctx: Ctx): void {
  const ignorar = ctx.est.convenio === 'CCT_644_12' ? IGNORAR_644 : IGNORAR_637
  const persA = [...ctx.est.fijoItems, ...ctx.est.noRemItems].filter(i => i.codigo.startsWith('PERS-A'))
  const persR = ctx.est.retencionItems.filter(i => i.codigo.startsWith('PERS-R'))

  for (const c of Object.values(ctx.recibo.conceptos)) {
    if (ctx.consumidos.has(c.codigo) || ignorar.has(c.codigo)) continue
    // Con ítem esperado del mismo código pero sin regla propia (aportes de ley ya
    // modelados: 20001/20002/20100/20101/20102/404xx): se consideran cubiertos.
    if (ctx.esperados.has(c.codigo)) continue

    // Adicional personal (ej. "Mayor función" cód. 50): comparación exacta por nombre.
    const adic = persA.find(i => mismoNombre(i.concepto, c.descripcion))
    if (adic) {
      ctx.haberes.add(c.codigo)
      compararExacto(ctx, c.codigo, adic.monto, adic.concepto)
      continue
    }
    // Retención personal (ej. cuota alimentaria cód. 20198): comparación informativa.
    const ret = persR.find(i => mismoNombre(i.concepto, c.descripcion))
    if (ret) {
      ctx.hallazgos.push({
        codigo: c.codigo, concepto: ret.concepto, esperado: ret.monto, pagado: c.monto, dif: c.monto - ret.monto,
        severidad: 'INFO',
        nota: 'Retención personal: comparación informativa contra tu configuración local.',
      })
      continue
    }
    ctx.hallazgos.push({
      codigo: c.codigo, concepto: c.descripcion, esperado: null, pagado: c.monto, dif: null,
      severidad: 'INFO', nota: 'Concepto del recibo no contemplado en el estimado local.',
    })
  }
}

/** Extrae el número entre paréntesis de un concepto del estimado, ej. "Viandas Adicionales (30)" → 30. */
function unidadesDeConcepto(concepto: string | undefined): number | null {
  if (!concepto) return null
  const m = /\((\d+)/.exec(concepto)
  return m ? Number(m[1]) : null
}

function mismoNombre(a: string, b: string): boolean {
  const na = normalizarNombre(a)
  const nb = normalizarNombre(b)
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))
}

function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function resumenLocal(veredicto: Veredicto, hallazgos: Hallazgo[], totalFaltante: number): string {
  const lineas: string[] = [
    veredicto === 'PAGO_INCOMPLETO'
      ? 'Pago incompleto: hay conceptos liquidados por debajo de la planilla/convenio.'
      : veredicto === 'REVISAR'
        ? 'Hay diferencias para revisar con RRHH.'
        : 'El recibo cierra contra el cálculo del período.',
  ]
  const reclamos = hallazgos.filter(h => h.severidad === 'FALTANTE' || h.severidad === 'REVISAR')
  if (reclamos.length > 0) {
    lineas.push('Para reclamar, en orden de solidez:')
    for (const h of [...reclamos].sort((a, b) => (a.severidad === 'FALTANTE' ? 0 : 1) - (b.severidad === 'FALTANTE' ? 0 : 1))) {
      lineas.push(`- ${h.concepto}: ${h.nota ?? `esperado ${fmt(h.esperado ?? 0)}, pagado ${fmt(h.pagado ?? 0)}.`}`)
    }
  }
  if (totalFaltante > 0) lineas.push(`Faltante estimado a tu favor (bruto): ${fmt(totalFaltante)}.`)
  return lineas.join('\n')
}

function fmt(v: number): string {
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtHs(v: number): string {
  return (Math.round(v * 10) / 10).toString()
}

function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`
}
