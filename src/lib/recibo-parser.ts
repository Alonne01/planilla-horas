// Parser PURO (sin browser) del texto plano de un recibo de haberes (liquidador
// WENLEN/CMH), portado de EquipTrack utils/recibo/ReciboParser.kt (verificado 1:1
// contra un recibo real 637: 22/22 conceptos exactos).
//
// Diferencia clave con EquipTrack: la PWA sirve a usuarios de AMBOS convenios y el
// recibo 644 usa códigos CORTOS y ambiguos ("2", "30", "50") que chocan con las
// unidades si se anclan como token suelto. Por eso acá se ancla por PAR
// (descripción, código): cada concepto conocido tiene una regex de descripción +
// su código, ej. /Sueldo básico CCT 644\/12\s+2(?![\d.,])/.
//
// Tolera el layout duplicado ORIGINAL/DUPLICADO (misma fila dos veces por línea o
// el documento repetido): la PRIMERA aparición de cada código gana.

import type { Convenio } from './calculo-salarial'

export interface ConceptoRecibo {
  codigo: string
  descripcion: string
  /** Unidades liquidadas (horas, días, años, cantidad), si la fila las trae. */
  unidades: number | null
  monto: number
}

export interface ReciboParseado {
  convenio: Convenio
  /** Período abonado, ej. "06/2026". */
  periodoAbonado: string | null
  /** Conceptos por código (deduplicados ORIGINAL/DUPLICADO). */
  conceptos: Record<string, ConceptoRecibo>
  totalNeto: number | null
}

interface ConceptoDef {
  codigo: string
  /** Nombre normalizado (para mostrar en los hallazgos). */
  nombre: string
  /** Ancla (descripción + código) sobre la línea del recibo. */
  regex: RegExp
  /** ¿La fila trae unidades (número corto sin miles) ANTES del monto? */
  conUnidades?: boolean
}

/** Construye la ancla /desc\s+codigo(?![\d.,])/i — el lookahead evita matchear el
 *  código como prefijo de un número más largo. */
function def(codigo: string, nombre: string, desc: string, opts: { u?: boolean } = {}): ConceptoDef {
  return {
    codigo,
    nombre,
    regex: new RegExp(`${desc}\\s+${codigo}(?![\\d.,])`, 'i'),
    conUnidades: opts.u === true,
  }
}

// ── CCT 637/11 (Jerárquicos) — códigos largos, verificados contra recibo real ──
const CONCEPTOS_637: ConceptoDef[] = [
  def('3001', 'Sueldo Básico', String.raw`Sueldo b[aá]sico.*?`),
  def('3010', 'Antigüedad', String.raw`Antig[uü]edad.*?`, { u: true }),
  def('3050', 'Presentismo', String.raw`Presentismo.*?`),
  def('3060', 'Bono Paz Social', String.raw`Bono paz social.*?`),
  def('3065', 'Adicional Torre/Campo', String.raw`Adicional torre.?campo.*?`),
  def('3130', 'Horas Viaje', String.raw`Horas viaje.*?`, { u: true }),
  def('3150', 'Extras 50%', String.raw`Horas extras 50\s*%.*?`, { u: true }),
  def('3155', 'Extras 100%', String.raw`Horas extras 100\s*%.*?`, { u: true }),
  def('3172', 'Desarraigo 20%', String.raw`Desarraigo.*?`),
  def('3373', 'Ant. Acta 9/11/22', String.raw`Ant\..*?`),
  def('3374', 'Ant. Acta 22/10/25', String.raw`Ant\..*?`),
  // Exenta art.65: se cancela a sí misma (3990 positivo, 3991 negativo) → se ignora al comparar.
  def('3990', 'Remuneración exenta', String.raw`Remuneraci[oó]n exenta.*?`),
  def('3991', 'Remuneración exenta (neg.)', String.raw`Remuneraci[oó]n exenta.*?`),
  def('20000', 'Jubilación 11%', String.raw`Jubilaci[oó]n.*?`),
  def('20001', 'Ley 19.032', String.raw`Ley 19\.?032.*?`),
  def('20002', 'Obra Social', String.raw`Obra social.*?`),
  def('20130', 'Cuota Sindical', String.raw`Cuota sindical.*?`),
  def('20131', 'Mutual PJ', String.raw`Mutual.*?`),
  def('90000', 'Ret. Imp. Ganancias', String.raw`Retenci[oó]n\s+imp.*?`),
  def('40310', 'Viandas art.34', String.raw`Viandas?\s+art.*?`, { u: true }),
  def('40312', 'Viandas Adicionales', String.raw`Viandas?\s+adicionales.*?`, { u: true }),
  def('40316', 'Desayuno y Merienda', String.raw`Desayuno y merienda.*?`, { u: true }),
  def('40497', 'SNR 3% s/remunerativo', String.raw`SNR.*?`),
  def('40498', 'SNR 3% s/no remunerativo', String.raw`SNR.*?`),
  def('42100', 'Vianda complementaria IG', String.raw`(?:Asignaci[oó]n\s+)?vianda complementaria IG.*?`),
  def('42210', 'Asig. Vianda Fija', String.raw`(?:Asignaci[oó]n\s+)?vianda complem\w*\s+fija.*?`),
  def('42220', 'Asig. Vaca Muerta', String.raw`(?:Asignaci[oó]n\s+)?Vaca Muerta.*?`),
  def('99999', 'Redondeo', String.raw`Redondeo.*?`),
  // Contribuciones del empleador: se parsean pero el comparador las ignora.
  def('85000', 'Contribución 85000', String.raw`.*?`),
  def('85100', 'Contribución 85100', String.raw`.*?`),
  def('85200', 'Contribución 85200', String.raw`.*?`),
  def('85400', 'Contribución 85400', String.raw`.*?`),
]

// ── CCT 644/12 (Privados) — códigos cortos: ancla estricta por descripción ──
// Líneas reales de un recibo de operador 06/2026 (ver tests).
const CONCEPTOS_644: ConceptoDef[] = [
  def('2', 'Sueldo Básico', String.raw`Sueldo b[aá]sico CCT 644/12`),
  def('18', 'Diferencial turno', String.raw`Diferencial turno(?:\s+[A-Za-z]+)?`),
  def('24', 'Zona Vaca Muerta', String.raw`Adicional zona vaca\s?muerta(?:\s+\d{1,3}\s*%)?`),
  def('30', 'Antigüedad', String.raw`Antig[uü]edad`, { u: true }),
  def('50', 'Mayor función', String.raw`Mayor funci[oó]n`),
  def('100', 'Bono Paz Social', String.raw`Bono paz social`),
  def('102', 'Adicional Torre/Campo', String.raw`Adicional torre.?campo`),
  def('150', 'Horas Viaje', String.raw`Horas viaje`, { u: true }),
  def('170', 'Extras 50%', String.raw`Horas extras 50\s*%`, { u: true }),
  def('171', 'Extras 100%', String.raw`Horas extras 100\s*%`, { u: true }),
  def('172', 'Dif. Nocturnas', String.raw`Diferencial horas nocturnas`, { u: true }),
  def('191', 'Desarraigo', String.raw`Desarraigo(?:\s+\d{1,3}\s*%)?`, { u: true }),
  def('300', 'Presentismo', String.raw`Presentismo(?:\s+\d{1,2}\s*%)?`),
  def('20000', 'Jubilación 11%', String.raw`Jubilaci[oó]n(?:\s+\d{1,2}\s*%)?`),
  def('20001', 'Ley 19.032', String.raw`Ley 19\.?032(?:\s+\d{1,2}\s*%)?`),
  def('20002', 'Obra Social', String.raw`Obra social(?:\s+\d{1,2}\s*%)?`),
  def('20100', 'Cuota Sindical', String.raw`Cuota sindical`),
  def('20101', 'Cuota Solidaria', String.raw`Cuota solidaria`),
  def('20102', 'Mutual MEOPP', String.raw`Mutual MEOPP`),
  def('20198', 'Cuota alimentaria', String.raw`Cuota alimentaria.*?`),
  def('40010', 'Vianda art.34', String.raw`Vianda`, { u: true }),
  def('40012', 'Vianda horas extras', String.raw`Vianda horas extras`, { u: true }),
  def('40016', 'Desayuno y Merienda', String.raw`Desayuno y merienda`, { u: true }),
  def('42200', 'Vianda complementaria IG', String.raw`(?:Asignaci[oó]n\s+)?vianda complementaria IG`),
  def('42210', 'Asig. Vianda Fija', String.raw`(?:Asignaci[oó]n\s+)?vianda complem\w*\s+fija`),
  def('42220', 'Asig. Vaca Muerta', String.raw`(?:Asignaci[oó]n\s+)?Vaca Muerta`),
  def('90000', 'Ret. Imp. Ganancias', String.raw`Retenci[oó]n\s+imp.*?`),
  def('99999', 'Redondeo', String.raw`Redondeo`),
]

function defsDe(convenio: Convenio): ConceptoDef[] {
  return convenio === 'CCT_644_12' ? CONCEPTOS_644 : CONCEPTOS_637
}

/** Nombre normalizado de un concepto conocido (para los hallazgos del comparador). */
export function nombreConcepto(convenio: Convenio, codigo: string): string {
  return defsDe(convenio).find(d => d.codigo === codigo)?.nombre ?? `Concepto ${codigo}`
}

// Monto: 1,234,567.89 (miles con coma, decimales con punto), opcionalmente negativo.
const RE_MONTO_FULL = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$/
// Número genérico: monto con miles O entero/decimal simple. La alternativa con miles
// va PRIMERO para no partir "42,049.84" en "42" + "049.84". (Igual que el Kotlin.)
const RE_NUMERO = /\s*(-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+(?:\.\d+)?)/y
const RE_PERIODO = /(\d{2}\/\d{4})\s+Mensuales/
const RE_NETO = /Total neto\s*:?\s*(-?[\d,]+\.\d{2})/gi

/** Números contiguos que siguen a `desde` (para hasta el primer texto no numérico). */
function numerosDesde(linea: string, desde: number): string[] {
  const nums: string[] = []
  RE_NUMERO.lastIndex = desde
  let m: RegExpExecArray | null
  while ((m = RE_NUMERO.exec(linea)) !== null) {
    nums.push(m[1])
  }
  return nums
}

/** Un número "chico" sin separador de miles se interpreta como unidades (7, 23, 41.00). */
function esUnidades(s: string): boolean {
  if (s.includes(',')) return false
  const v = Number(s)
  return Number.isFinite(v) && v >= 0 && v < 10_000
}

function parseMonto(s: string): number {
  return Number(s.replace(/,/g, ''))
}

/**
 * Parsea el texto plano del recibo (capa de texto del PDF) para el convenio dado.
 * Solo reconoce los conceptos de la tabla anclada por (descripción, código);
 * el resto del texto (nombre, CUIL, leyendas) se ignora.
 */
export function parsearRecibo(texto: string, convenio: Convenio): ReciboParseado {
  const defs = defsDe(convenio)
  const conceptos: Record<string, ConceptoRecibo> = {}

  for (const lineaCruda of texto.split(/\r?\n/)) {
    const linea = lineaCruda.trim()
    if (!linea) continue
    for (const d of defs) {
      // Dedupe ORIGINAL/DUPLICADO: la primera aparición de cada código gana.
      if (conceptos[d.codigo]) continue
      const m = d.regex.exec(linea)
      if (!m) continue
      const nums = numerosDesde(linea, m.index + m[0].length)
      if (nums.length === 0) continue

      // Con unidades: "20.00 120,142.40" o "2 12,014.24" → primero unidades, después monto.
      // Sin unidades: el primer número con formato de monto es el monto.
      let unidades: number | null = null
      let monto: number
      if (d.conUnidades && nums.length >= 2 && esUnidades(nums[0])) {
        unidades = parseMonto(nums[0])
        monto = parseMonto(nums[1])
      } else {
        monto = parseMonto(nums.find(n => RE_MONTO_FULL.test(n)) ?? nums[0])
      }
      conceptos[d.codigo] = { codigo: d.codigo, descripcion: d.nombre, unidades, monto }
    }
  }

  const periodoAbonado = RE_PERIODO.exec(texto)?.[1] ?? null

  // Total neto: el recibo trae 0.00 en la página 1 y el real en la última → tomar el máximo.
  let totalNeto: number | null = null
  for (const m of texto.matchAll(RE_NETO)) {
    const v = parseMonto(m[1])
    if (v > 0 && (totalNeto === null || v > totalNeto)) totalNeto = v
  }

  return { convenio, periodoAbonado, conceptos, totalNeto }
}
