// Extracción de la CAPA DE TEXTO de un PDF (recibo de sueldo digital) con pdf.js.
// Sin OCR: si el PDF es un escaneo (imagen), la capa de texto viene vacía o casi
// vacía y se rechaza con un error claro. Los items de texto de cada página se
// agrupan por renglón usando la coordenada Y del transform (misma Y ≈ misma fila)
// y se ordenan por X para reconstruir las líneas tal como se leen.
//
// pdf.js y su worker se cargan con import() dinámico y el worker con `?worker`
// (bundleado por Vite como chunk .js propio): no se toca ningún CDN y el service
// worker de la PWA lo pre-cachea igual que el resto de los .js (offline-first).

// Import SOLO de tipos (se borra al compilar): pdf.js real se carga con import() dinámico.
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Error tipado de la extracción: la UI muestra `message` tal cual. */
export class ReciboPdfError extends Error {
  tipo: 'ESCANEADO' | 'INVALIDO'

  constructor(tipo: 'ESCANEADO' | 'INVALIDO', mensaje: string) {
    super(mensaje)
    this.name = 'ReciboPdfError'
    this.tipo = tipo
  }
}

/** Menos de esto en toda la capa de texto ⇒ es un escaneo (sin texto real). */
const MIN_CARACTERES = 200

/** Dos items con |ΔY| ≤ esta tolerancia (unidades PDF) pertenecen al mismo renglón. */
const TOLERANCIA_Y = 2

interface Fragmento { x: number; y: number; str: string }

/** Agrupa los fragmentos de texto de una página en renglones por Y aproximada. */
function agruparEnLineas(frags: Fragmento[]): string[] {
  // Orden de lectura: Y descendente (en PDF la Y crece hacia arriba), luego X ascendente.
  frags.sort((a, b) => b.y - a.y || a.x - b.x)
  const lineas: string[] = []
  let fila: Fragmento[] = []
  for (const f of frags) {
    if (fila.length > 0 && fila[0].y - f.y > TOLERANCIA_Y) {
      lineas.push(renderFila(fila))
      fila = []
    }
    fila.push(f)
  }
  if (fila.length > 0) lineas.push(renderFila(fila))
  return lineas
}

function renderFila(fila: Fragmento[]): string {
  return fila
    .slice()
    .sort((a, b) => a.x - b.x)
    .map(f => f.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extrae el texto plano del PDF, renglón por renglón (todas las páginas).
 * Lanza ReciboPdfError('ESCANEADO') si el PDF no tiene capa de texto útil
 * y ReciboPdfError('INVALIDO') si el archivo no se puede abrir como PDF.
 */
export async function extraerTextoPdf(archivo: File | Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
    // Worker bundleado por Vite (chunk propio, sin CDN): la PWA lo cachea offline.
    const { default: PdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
  }

  const data = new Uint8Array(await archivo.arrayBuffer())
  const tarea = pdfjs.getDocument({ data })
  let doc: PDFDocumentProxy
  try {
    doc = await tarea.promise
  } catch {
    throw new ReciboPdfError('INVALIDO', 'El archivo no se pudo leer como PDF.')
  }

  try {
    const paginas: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const frags: Fragmento[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        frags.push({ x: item.transform[4], y: item.transform[5], str: item.str })
      }
      paginas.push(agruparEnLineas(frags).join('\n'))
    }
    const texto = paginas.join('\n')
    if (texto.trim().length < MIN_CARACTERES) {
      throw new ReciboPdfError('ESCANEADO', 'PDF escaneado no soportado, cargá el PDF original del recibo digital.')
    }
    return texto
  } finally {
    void tarea.destroy() // libera el documento y su memoria en el worker
  }
}
