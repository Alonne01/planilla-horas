// Excel export — Normal mode (writes data into the original template_horas.xlsx)
// Uses fflate to preserve template images/drawings that SheetJS CE strips on write.
// Template stores times as DECIMAL HOURS (e.g. 8.5 = 08:30) in columns C-F with
// format "0.00", and column G has a formula =IFERROR((D-C)+(F-E) [Base -1h], 0).
import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import type { RegistroHoras } from '../db/database'
import { periodoStart, periodoEnd, MESES_ES } from './diagrama'

/** ms timestamp → decimal hours (e.g. 08:30 → 8.5) */
function msToDecimalHours(ms: number | null | undefined): number | null {
  if (!ms) return null
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

/** JS Date → Excel serial (days since Dec 30, 1899, matching Excel's epoch+bug) */
function dateToExcelSerial(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000) + 25569
}

/** Grab the existing cell's style index so we can preserve template formatting */
function getS(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ws[XLSX.utils.encode_cell({ r, c })] as any)?.s
}

/** Write string cell, preserving existing cell style */
function scStr(ws: XLSX.WorkSheet, r: number, c: number, v: string) {
  const s = getS(ws, r, c)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cell: any = { v, t: 's' }
  if (s != null) cell.s = s
  ws[XLSX.utils.encode_cell({ r, c })] = cell
}

/** Write numeric cell, preserving existing cell style AND setting z for number/date display */
function scNum(ws: XLSX.WorkSheet, r: number, c: number, v: number, z?: string) {
  const s = getS(ws, r, c)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cell: any = { v, t: 'n' }
  if (s != null) cell.s = s
  if (z) cell.z = z   // Always set z — needed for SheetJS to render cell.w correctly
  ws[XLSX.utils.encode_cell({ r, c })] = cell
}

/** Write time cell as decimal hours, preserving existing cell style */
function scTime(ws: XLSX.WorkSheet, r: number, c: number, ms: number | null | undefined) {
  const dec = msToDecimalHours(ms)
  if (dec != null) scNum(ws, r, c, dec, '0.00')
  else scStr(ws, r, c, '')
}

/** Write header cells (string or number), preserving existing cell style */
function sc(ws: XLSX.WorkSheet, r: number, c: number, v: string | number) {
  const s = getS(ws, r, c)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cell: any = typeof v === 'number' ? { v, t: 'n' } : { v, t: 's' }
  if (s != null) cell.s = s
  ws[XLSX.utils.encode_cell({ r, c })] = cell
}

function escribirFila(
  ws: XLSX.WorkSheet,
  rowIdx: number,
  dia: Date,
  reg: RegistroHoras | undefined,
  diagramaLabel: string,
) {
  // Clear column A cross-workbook reference (='[1]ALMEIRA LUIS'!AXX → #REF!)
  scStr(ws, rowIdx, 0, '')
  // Write date as Excel serial with Spanish date format (displays as "21-may")
  scNum(ws, rowIdx, 1, dateToExcelSerial(dia), '[$-40A]dd\\-mmm')

  const dow = dia.getDay()
  const isWeekend = dow === 0 || dow === 6

  if (reg == null) {
    const esLV = !diagramaLabel || diagramaLabel.toLowerCase().includes('lun')
    if (isWeekend && esLV) {
      // LV weekend = franco; '-' in C/F triggers IFERROR in G → 0
      scStr(ws, rowIdx, 2, '-'); scStr(ws, rowIdx, 3, ''); scStr(ws, rowIdx, 4, ''); scStr(ws, rowIdx, 5, '-')
      // col 6 (G): formula preserved — skip write
      scStr(ws, rowIdx, 7, '-'); scStr(ws, rowIdx, 8, '')
      scStr(ws, rowIdx, 9, '-'); scStr(ws, rowIdx, 10, '-'); scStr(ws, rowIdx, 11, '-'); scStr(ws, rowIdx, 12, '-')
      scStr(ws, rowIdx, 13, 'franco')
    } else {
      scStr(ws, rowIdx, 2, ''); scStr(ws, rowIdx, 3, ''); scStr(ws, rowIdx, 4, ''); scStr(ws, rowIdx, 5, '')
      for (let c = 7; c <= 13; c++) scStr(ws, rowIdx, c, '')
    }
    return
  }

  if (reg.lugarTrabajo === 'Franco') {
    const isFeriadoTrabajado = reg.esFeriadoTrabajado && reg.entradaInicioMs != null
    const isFrancoTrabajadoLegacy = reg.esFrancoTrabajado && reg.entradaInicioMs != null
    if (isFeriadoTrabajado || isFrancoTrabajadoLegacy) {
      const hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
      if (!hasTurno2) {
        scTime(ws, rowIdx, 2, reg.entradaInicioMs); scStr(ws, rowIdx, 3, '')
        scStr(ws, rowIdx, 4, ''); scTime(ws, rowIdx, 5, reg.salidaInicioMs)
      } else {
        scTime(ws, rowIdx, 2, reg.entradaInicioMs); scTime(ws, rowIdx, 3, reg.salidaInicioMs)
        scTime(ws, rowIdx, 4, reg.entradaFinMs); scTime(ws, rowIdx, 5, reg.salidaFinMs)
      }
      // G formula calculates automatically (al 100% = Campo-like, no -1h deduction)
      scStr(ws, rowIdx, 7, reg.horasViaje > 0 ? 'SI' : 'NO')
      scStr(ws, rowIdx, 8, '')
      scStr(ws, rowIdx, 9, ''); scStr(ws, rowIdx, 10, ''); scStr(ws, rowIdx, 11, ''); scStr(ws, rowIdx, 12, '')
      const obsBase = reg.observaciones ?? ''
      scStr(ws, rowIdx, 13, isFrancoTrabajadoLegacy
        ? `franco trabajado${obsBase ? ' - ' + obsBase : ''}`
        : (obsBase ? `feriado trabajado - ${obsBase}` : 'feriado trabajado'))
    } else {
      const etiqueta = reg.esAusenciaJustificada ? 'ausencia just.'
        : reg.esFeriado ? 'feriado'
        : reg.esFrancoCompensatorio ? 'franco (comp.)'
        : 'franco'
      scStr(ws, rowIdx, 2, '-'); scStr(ws, rowIdx, 3, ''); scStr(ws, rowIdx, 4, ''); scStr(ws, rowIdx, 5, '-')
      // G formula: IFERROR catches '-' string operands → returns 0
      scStr(ws, rowIdx, 7, '-'); scStr(ws, rowIdx, 8, '')
      scStr(ws, rowIdx, 9, '-'); scStr(ws, rowIdx, 10, '-'); scStr(ws, rowIdx, 11, '-'); scStr(ws, rowIdx, 12, '-')
      scStr(ws, rowIdx, 13, etiqueta + (reg.observaciones ? ` - ${reg.observaciones}` : ''))
    }
    return
  }

  // Normal workday (Base or Campo)
  const hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
  if (!hasTurno2) {
    scTime(ws, rowIdx, 2, reg.entradaInicioMs); scStr(ws, rowIdx, 3, '')
    scStr(ws, rowIdx, 4, ''); scTime(ws, rowIdx, 5, reg.salidaInicioMs)
  } else {
    scTime(ws, rowIdx, 2, reg.entradaInicioMs); scTime(ws, rowIdx, 3, reg.salidaInicioMs)
    scTime(ws, rowIdx, 4, reg.entradaFinMs); scTime(ws, rowIdx, 5, reg.salidaFinMs)
  }
  // G formula: =IFERROR(IF(IF(I="Base",(D-C)+(F-E)-1,(D-C)+(F-E))>16,16,...),0)
  // Calculates automatically from decimal hour values we wrote above — do NOT overwrite.
  scStr(ws, rowIdx, 7, reg.horasViaje > 0 ? 'SI' : 'NO')
  scStr(ws, rowIdx, 8, reg.lugarTrabajo)
  scStr(ws, rowIdx, 9, reg.pernocte === 'Hotel' ? 'x' : '')
  scStr(ws, rowIdx, 10, reg.pernocte === 'Trailer' ? 'x' : '')
  scStr(ws, rowIdx, 11, reg.pernocte === 'NO' ? 'x' : '')
  scStr(ws, rowIdx, 12, reg.maneja ? 'x' : '')
  let obs = reg.observaciones ?? ''
  if (reg.esFrancoTrabajado) obs = `franco trabajado${obs ? ' - ' + obs : ''}`
  scStr(ws, rowIdx, 13, obs)
}

/**
 * Patches the SheetJS output ZIP with media/drawings/styles from the template ZIP,
 * so the logo image and cell formatting are preserved in the exported file.
 */
async function patchWithTemplateMedia(templateBytes: Uint8Array, outputBytes: Uint8Array): Promise<Uint8Array> {
  try {
    const templateZip = unzipSync(templateBytes)
    const outputZip = unzipSync(outputBytes)

    // Copy visual assets from template (media and drawings only; styles handled by SheetJS)
    for (const [path, data] of Object.entries(templateZip)) {
      if (
        path.startsWith('xl/media/') ||
        path.startsWith('xl/drawings/')
      ) {
        outputZip[path] = data
      }
    }

    // Merge worksheet rels: add drawing relationship without overwriting SheetJS rels
    const relsKey = 'xl/worksheets/_rels/sheet1.xml.rels'
    if (templateZip[relsKey]) {
      const templateRels = new TextDecoder().decode(templateZip[relsKey])
      const drawingRel = templateRels.match(/<Relationship[^>]+drawing[^>]+\/>/)
      if (drawingRel) {
        // Use rId99 to avoid conflicting with any SheetJS-generated rIds
        const safeRel = drawingRel[0].replace(/Id="[^"]*"/, 'Id="rId99"')
        if (outputZip[relsKey]) {
          let outputRels = new TextDecoder().decode(outputZip[relsKey])
          if (!outputRels.includes('drawing')) {
            outputRels = outputRels.replace('</Relationships>', `${safeRel}</Relationships>`)
            outputZip[relsKey] = strToU8(outputRels)
          }
        } else {
          outputZip[relsKey] = strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeRel}</Relationships>`
          )
        }
      }
    }

    // Inject <drawing r:id="rId99"/> into sheet1.xml before </worksheet>
    const sheetKey = 'xl/worksheets/sheet1.xml'
    if (outputZip[sheetKey]) {
      let sheetXml = new TextDecoder().decode(outputZip[sheetKey])
      if (!sheetXml.includes('<drawing') && sheetXml.includes('</worksheet>')) {
        sheetXml = sheetXml.replace(
          '</worksheet>',
          '<drawing r:id="rId99"/></worksheet>'
        )
        outputZip[sheetKey] = strToU8(sheetXml)
      }
    }

    // Patch [Content_Types].xml: add Override entries for drawings (Excel requires these)
    const ctKey = '[Content_Types].xml'
    if (templateZip[ctKey] && outputZip[ctKey]) {
      const templateCT = new TextDecoder().decode(templateZip[ctKey])
      let outputCT = new TextDecoder().decode(outputZip[ctKey])
      const overrideMatches = [...templateCT.matchAll(/<Override[^>]*\/xl\/drawings\/[^>]*\/>/g)]
      for (const m of overrideMatches) {
        if (!outputCT.includes('/xl/drawings/')) {
          outputCT = outputCT.replace('</Types>', `${m[0]}</Types>`)
        }
      }
      outputZip[ctKey] = strToU8(outputCT)
    }

    return zipSync(outputZip, { level: 6 })
  } catch {
    // If patching fails, return original output
    return outputBytes
  }
}

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

  const workbook = XLSX.read(templateBytes, { type: 'array', cellStyles: true })
  const ws = workbook.Sheets[workbook.SheetNames[0]]

  const mesAnterior = MESES_ES[mes === 0 ? 11 : mes - 1]
  const mesActual = MESES_ES[mes]

  // Always overwrite — clears the template's default "Vazquez Nicolas"
  sc(ws, 4, 2, nombreUsuario)
  sc(ws, 6, 2, `${mesAnterior.toLowerCase()}-${mesActual.toLowerCase()} ${anio}`)
  if (diagramaLabel) sc(ws, 6, 8, `Diagrama:    ${diagramaLabel}`)

  const byDay = new Map(registros.map(r => {
    const d = new Date(r.fechaMs)
    return [`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, r]
  }))

  let dataRowIdx = 11
  const cur = new Date(periodoStart(mes, anio))
  const end = periodoEnd(mes, anio)
  while (cur <= end) {
    escribirFila(ws, dataRowIdx, new Date(cur), byDay.get(`${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`), diagramaLabel)
    dataRowIdx++
    cur.setDate(cur.getDate() + 1)
  }

  for (let i = dataRowIdx; i < 11 + 31; i++) {
    scStr(ws, i, 0, '') // Clear column A cross-workbook ref
    for (let c = 1; c <= 13; c++) {
      if (c === 6) continue // Skip G — preserve formula, returns 0 for empty rows
      scStr(ws, i, c, '')
    }
  }

  // Write to buffer (not file) so we can patch media
  const outputBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as Uint8Array
  const patched = await patchWithTemplateMedia(templateBytes, new Uint8Array(outputBytes))

  // Trigger download
  const blob = new Blob([patched.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
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
