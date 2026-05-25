// Excel export — Normal mode (writes data into the original template_horas.xlsx)
//
// Approach: direct XML manipulation of the template ZIP.
// SheetJS CE regenerates xl/styles.xml from scratch on write, destroying all custom
// cell formatting. By keeping the template ZIP intact and only modifying sheet1.xml
// in place, we preserve every border, fill, number format, and drawing reference.
//
// Template stores times as DECIMAL HOURS (e.g. 8.5 = 08:30) in columns C–F.
// Column G has an IFERROR formula that calculates worked hours automatically.
// Column A has cross-workbook refs that must be cleared (='' styled empty cell).

import { unzipSync, zipSync, strToU8 } from 'fflate'
import type { RegistroHoras } from '../db/database'
import { periodoStart, periodoEnd, MESES_ES } from './diagrama'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function dateToExcelSerial(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000) + 25569
}

function msToDecimalHours(ms: number | null | undefined): number | null {
  if (!ms) return null
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

// ─── Cell XML builders ─────────────────────────────────────────────────────────
// s = style index from template (preserved verbatim — never regenerated)

/** Styled empty cell (no value) */
const cEmpty = (r: string, s: number) => `<c r="${r}" s="${s}"/>`

/** Numeric cell */
const cNum = (r: string, s: number, v: number) => `<c r="${r}" s="${s}"><v>${v}</v></c>`

/** Inline-string cell; empty value → styled empty cell (avoids updating sharedStrings.xml) */
function cStr(r: string, s: number, v: string): string {
  if (!v) return cEmpty(r, s)
  return `<c r="${r}" s="${s}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`
}

/** Time cell → decimal hours; null/undefined → empty */
function cTime(r: string, s: number, ms: number | null | undefined): string {
  const dec = msToDecimalHours(ms)
  return dec != null ? cNum(r, s, dec) : cEmpty(r, s)
}

/**
 * Salida cell with overnight adjustment.
 * If salidaMs decimal hours < entradaMs decimal hours, it's a cross-midnight shift → add 24.
 * Example: entrada 20:00 (dec=20), salida 08:00 (dec=8) → stored as 32 so Excel formula F-C = 32-20 = 12.
 */
function cSalida(r: string, s: number, entradaMs: number | null | undefined, salidaMs: number | null | undefined): string {
  const e = msToDecimalHours(entradaMs)
  const raw = msToDecimalHours(salidaMs)
  if (raw == null) return cEmpty(r, s)
  const dec = (e != null && raw < e) ? raw + 24 : raw
  return cNum(r, s, dec)
}

// ─── Template style indices (determined by inspecting the template ZIP) ────────
//
// Row 12 (first data row) has a heavier top border — different style indices.
// Rows 13-42 share a repeating visual band style.
//
//  Col: A   B   C   D   E   F   (G=formula, preserved)  H   I   J   K   L   M   N
const S12 = { A:3, B:34, C:35, D:36, E:36, F:35, H:38, I:38, J:38, K:38, L:38, M:39, N:40 } as const
const SN  = { A:3, B:41, C:42, D:43, E:43, F:42, H:45, I:45, J:45, K:45, L:45, M:46, N:47 } as const

// ─── Row cell builder ──────────────────────────────────────────────────────────
// Returns [cellsBeforeG, cellsAfterG] so the caller can splice in the template G cell.

function buildRowParts(
  rowNum: number,
  dia: Date,
  reg: RegistroHoras | undefined,
  diagramaLabel: string,
): [string, string] {
  const s = rowNum === 12 ? S12 : SN
  const n = rowNum

  const cellA = cEmpty(`A${n}`, s.A)             // always clear cross-workbook ref
  const cellB = cNum(`B${n}`, s.B, dateToExcelSerial(dia))

  const dow = dia.getDay()
  const isWeekend = dow === 0 || dow === 6

  // ── No registro ────────────────────────────────────────────────────────────
  if (reg == null) {
    const esLV = !diagramaLabel || diagramaLabel.toLowerCase().includes('lun')
    if (isWeekend && esLV) {
      return [
        [cellA, cellB, cStr(`C${n}`, s.C, '-'), cEmpty(`D${n}`, s.D), cEmpty(`E${n}`, s.E), cStr(`F${n}`, s.F, '-')].join(''),
        [cStr(`H${n}`, s.H, '-'), cEmpty(`I${n}`, s.I),
          cStr(`J${n}`, s.J, '-'), cStr(`K${n}`, s.K, '-'), cStr(`L${n}`, s.L, '-'), cStr(`M${n}`, s.M, '-'),
          cStr(`N${n}`, s.N, 'franco')].join(''),
      ]
    }
    return [
      [cellA, cellB, cEmpty(`C${n}`, s.C), cEmpty(`D${n}`, s.D), cEmpty(`E${n}`, s.E), cEmpty(`F${n}`, s.F)].join(''),
      [cEmpty(`H${n}`, s.H), cEmpty(`I${n}`, s.I), cEmpty(`J${n}`, s.J),
        cEmpty(`K${n}`, s.K), cEmpty(`L${n}`, s.L), cEmpty(`M${n}`, s.M), cEmpty(`N${n}`, s.N)].join(''),
    ]
  }

  // ── Franco / absence ───────────────────────────────────────────────────────
  if (reg.lugarTrabajo === 'Franco') {
    const hasWork = reg.entradaInicioMs != null
    const isFrancoTrab = reg.esFrancoTrabajado && hasWork
    const isFeriadoTrab = reg.esFeriadoTrabajado && hasWork

    if (isFrancoTrab || isFeriadoTrab) {
      const hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
      const isOvernightFT = !hasTurno2 &&
        reg.entradaInicioMs != null && reg.salidaInicioMs != null &&
        msToDecimalHours(reg.salidaInicioMs)! < msToDecimalHours(reg.entradaInicioMs)!
      const [cC, cD, cE, cF] = hasTurno2
        ? [cTime(`C${n}`, s.C, reg.entradaInicioMs), cSalida(`D${n}`, s.D, reg.entradaInicioMs, reg.salidaInicioMs),
           cTime(`E${n}`, s.E, reg.entradaFinMs),    cSalida(`F${n}`, s.F, reg.entradaFinMs, reg.salidaFinMs)]
        : isOvernightFT
        ? [cTime(`C${n}`, s.C, reg.entradaInicioMs), cNum(`D${n}`, s.D, 24),
           cNum(`E${n}`, s.E, 0),                    cTime(`F${n}`, s.F, reg.salidaInicioMs)]
        : [cTime(`C${n}`, s.C, reg.entradaInicioMs), cEmpty(`D${n}`, s.D),
           cEmpty(`E${n}`, s.E),                     cSalida(`F${n}`, s.F, reg.entradaInicioMs, reg.salidaInicioMs)]
      const obsBase = reg.observaciones ?? ''
      const obs = isFrancoTrab
        ? `franco trabajado${obsBase ? ' - ' + obsBase : ''}`
        : (obsBase ? `feriado trabajado - ${obsBase}` : 'feriado trabajado')
      return [
        [cellA, cellB, cC, cD, cE, cF].join(''),
        [cStr(`H${n}`, s.H, reg.horasViaje > 0 ? 'SI' : 'NO'), cEmpty(`I${n}`, s.I),
          cEmpty(`J${n}`, s.J), cEmpty(`K${n}`, s.K), cEmpty(`L${n}`, s.L), cEmpty(`M${n}`, s.M),
          cStr(`N${n}`, s.N, obs)].join(''),
      ]
    }

    const etiqueta = reg.esAusenciaJustificada ? 'ausencia just.'
      : reg.esFeriado ? 'feriado'
      : reg.esFrancoCompensatorio ? 'franco (comp.)'
      : 'franco'
    return [
      [cellA, cellB, cStr(`C${n}`, s.C, '-'), cEmpty(`D${n}`, s.D), cEmpty(`E${n}`, s.E), cStr(`F${n}`, s.F, '-')].join(''),
      [cStr(`H${n}`, s.H, '-'), cEmpty(`I${n}`, s.I),
        cStr(`J${n}`, s.J, '-'), cStr(`K${n}`, s.K, '-'), cStr(`L${n}`, s.L, '-'), cStr(`M${n}`, s.M, '-'),
        cStr(`N${n}`, s.N, etiqueta + (reg.observaciones ? ` - ${reg.observaciones}` : ''))].join(''),
    ]
  }

  // ── Normal workday (Base / Campo) ──────────────────────────────────────────
  const hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
  // Overnight single-turno: split into [entrada→24] + [0→salida] so cells
  // read as "20 | 24" and "0 | 08". Template formula (D-C)+(F-E) still gives
  // correct total: (24-20)+(8-0)=12 for a 20:00→08:00 shift.
  const isOvernight = !hasTurno2 &&
    reg.entradaInicioMs != null && reg.salidaInicioMs != null &&
    msToDecimalHours(reg.salidaInicioMs)! < msToDecimalHours(reg.entradaInicioMs)!
  const [cC, cD, cE, cF] = hasTurno2
    ? [cTime(`C${n}`, s.C, reg.entradaInicioMs), cSalida(`D${n}`, s.D, reg.entradaInicioMs, reg.salidaInicioMs),
       cTime(`E${n}`, s.E, reg.entradaFinMs),    cSalida(`F${n}`, s.F, reg.entradaFinMs, reg.salidaFinMs)]
    : isOvernight
    ? [cTime(`C${n}`, s.C, reg.entradaInicioMs), cNum(`D${n}`, s.D, 24),
       cNum(`E${n}`, s.E, 0),                    cTime(`F${n}`, s.F, reg.salidaInicioMs)]
    : [cTime(`C${n}`, s.C, reg.entradaInicioMs), cEmpty(`D${n}`, s.D),
       cEmpty(`E${n}`, s.E),                     cSalida(`F${n}`, s.F, reg.entradaInicioMs, reg.salidaInicioMs)]
  let obs = reg.observaciones ?? ''
  if (reg.esFrancoTrabajado) obs = `franco trabajado${obs ? ' - ' + obs : ''}`

  return [
    [cellA, cellB, cC, cD, cE, cF].join(''),
    [cStr(`H${n}`, s.H, reg.horasViaje > 0 ? 'SI' : 'NO'),
      cStr(`I${n}`, s.I, reg.lugarTrabajo),
      cStr(`J${n}`, s.J, reg.pernocte === 'Hotel' ? 'x' : ''),
      cStr(`K${n}`, s.K, reg.pernocte === 'Trailer' ? 'x' : ''),
      cStr(`L${n}`, s.L, reg.pernocte === 'NO' ? 'x' : ''),
      cStr(`M${n}`, s.M, reg.maneja ? 'x' : ''),
      cStr(`N${n}`, s.N, obs)].join(''),
  ]
}

// ─── Sheet XML manipulation ────────────────────────────────────────────────────

/**
 * Replaces a single cell element in the sheet XML.
 * Handles both self-closing <c ... /> and content form <c ...>...</c>.
 */
function replaceCellXml(xml: string, addr: string, newCell: string): string {
  const re = new RegExp(
    `<c r="${addr}"(?:\\s[^>]*)?\\/>`
    + `|<c r="${addr}"(?:\\s[^>]*)?>(?:[^<]|<(?!\\/c>))*<\\/c>`,
  )
  return xml.includes(`r="${addr}"`) ? xml.replace(re, newCell) : xml
}

/**
 * Replaces all data rows (12–42) and the two header cells in the sheet XML.
 * Every other entry in the ZIP (styles.xml, drawings, media, rels, etc.) is
 * left completely untouched — this is what preserves the cell formatting.
 */
function writeSheetData(
  sheetXml: string,
  mes: number,
  anio: number,
  registros: RegistroHoras[],
  nombreUsuario: string,
  diagramaLabel: string,
): string {
  const mesAnterior = MESES_ES[mes === 0 ? 11 : mes - 1]
  const mesActual = MESES_ES[mes]

  // Header cells (style indices from template inspection)
  sheetXml = replaceCellXml(sheetXml, 'C5', cStr('C5', 7, nombreUsuario))
  sheetXml = replaceCellXml(sheetXml, 'C7', cStr('C7', 10, `${mesAnterior.toLowerCase()}-${mesActual.toLowerCase()} ${anio}`))
  if (diagramaLabel) {
    sheetXml = replaceCellXml(sheetXml, 'I7', cStr('I7', 8, `Diagrama:    ${diagramaLabel}`))
  }

  // Build day lookup
  const byDay = new Map<string, RegistroHoras>()
  for (const r of registros) {
    const d = new Date(r.fechaMs)
    byDay.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, r)
  }

  // Data rows 12–42
  const cur = new Date(periodoStart(mes, anio))
  const endDate = periodoEnd(mes, anio)
  let rowNum = 12

  while (cur <= endDate && rowNum <= 42) {
    const dia = new Date(cur)
    const reg = byDay.get(`${dia.getFullYear()}-${dia.getMonth()}-${dia.getDate()}`)
    sheetXml = replaceDataRow(sheetXml, rowNum, dia, reg, diagramaLabel)
    cur.setDate(cur.getDate() + 1)
    rowNum++
  }

  // Clear remaining rows for short months
  while (rowNum <= 42) {
    sheetXml = clearDataRow(sheetXml, rowNum)
    rowNum++
  }

  return sheetXml
}

/** Replace one data row, preserving the opening tag attributes and G formula cell. */
function replaceDataRow(
  xml: string,
  rowNum: number,
  dia: Date,
  reg: RegistroHoras | undefined,
  diagramaLabel: string,
): string {
  const rowRe = new RegExp(`(<row(?:[^>]*\\s)?r="${rowNum}"[^>]*>)([\\s\\S]*?)(<\\/row>)`)
  const m = xml.match(rowRe)
  if (!m) return xml

  const openTag = m[1]
  const originalContent = m[2]
  const closeTag = m[3]

  // Extract the G formula cell verbatim from the template row
  const gMatch = originalContent.match(/<c r="G\d+"[^>]*>[\s\S]*?<\/c>/)
  const gCell = gMatch ? gMatch[0] : ''

  const [before, after] = buildRowParts(rowNum, dia, reg, diagramaLabel)
  return xml.replace(rowRe, `${openTag}${before}${gCell}${after}${closeTag}`)
}

/** Clear a data row (short-month overflow): empty styled cells, G formula preserved. */
function clearDataRow(xml: string, rowNum: number): string {
  const rowRe = new RegExp(`(<row(?:[^>]*\\s)?r="${rowNum}"[^>]*>)([\\s\\S]*?)(<\\/row>)`)
  const m = xml.match(rowRe)
  if (!m) return xml

  const openTag = m[1]
  const originalContent = m[2]
  const closeTag = m[3]

  const gMatch = originalContent.match(/<c r="G\d+"[^>]*>[\s\S]*?<\/c>/)
  const gCell = gMatch ? gMatch[0] : ''

  const s = rowNum === 12 ? S12 : SN
  const n = rowNum
  const before = [cEmpty(`A${n}`, s.A), cEmpty(`B${n}`, s.B), cEmpty(`C${n}`, s.C),
                  cEmpty(`D${n}`, s.D), cEmpty(`E${n}`, s.E), cEmpty(`F${n}`, s.F)].join('')
  const after  = [cEmpty(`H${n}`, s.H), cEmpty(`I${n}`, s.I), cEmpty(`J${n}`, s.J),
                  cEmpty(`K${n}`, s.K), cEmpty(`L${n}`, s.L), cEmpty(`M${n}`, s.M), cEmpty(`N${n}`, s.N)].join('')

  return xml.replace(rowRe, `${openTag}${before}${gCell}${after}${closeTag}`)
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function exportarExcelNormal(
  mes: number,
  anio: number,
  registros: RegistroHoras[],
  nombreUsuario: string,
  diagramaLabel: string,
): Promise<void> {
  const resp = await fetch(`${import.meta.env.BASE_URL}template_horas.xlsx`)
  if (!resp.ok) throw new Error(`No se pudo cargar el template: ${resp.status}`)
  const templateBytes = new Uint8Array(await resp.arrayBuffer())

  // Unzip template, patch sheet1.xml only, keep all other entries intact
  const zip = unzipSync(templateBytes)
  const sheetKey = 'xl/worksheets/sheet1.xml'
  const originalXml = new TextDecoder().decode(zip[sheetKey])
  const modifiedXml = writeSheetData(originalXml, mes, anio, registros, nombreUsuario, diagramaLabel)
  zip[sheetKey] = strToU8(modifiedXml)

  // Drop the stale calculation chain — Excel regenerates it on open.
  // Without this, Excel detects a mismatch between the chain and the modified
  // cells and shows the "We found a problem" repair dialog.
  delete zip['xl/calcChain.xml']

  const outputBytes = zipSync(zip, { level: 6 })

  const mesAnterior = MESES_ES[mes === 0 ? 11 : mes - 1]
  const mesActual = MESES_ES[mes]
  const blob = new Blob([outputBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = (nombreUsuario || 'Planilla').replace(/[/\\:*?"<>|]/g, '_')
  a.href = url
  a.download = `Planilla de horas ${safeName} (${mesAnterior} - ${mesActual} - ${anio}).xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
