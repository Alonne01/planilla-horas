import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// Genera los iconos PNG (192 / 512) del PWA a partir de la imagen fuente `public/icons/icon-source.png`
// (cronómetro sobre planilla, provista por el usuario). Se reescala envolviéndola en un <image> SVG
// y renderizando con resvg, así queda nítida y con las esquinas transparentes preservadas.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.resolve(__dirname, '../public/icons')
const srcPath = path.join(iconsDir, 'icon-source.png')

const srcB64 = readFileSync(srcPath).toString('base64')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <image href="data:image/png;base64,${srcB64}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid meet"/>
</svg>`

function render(size, outPath) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } })
  writeFileSync(outPath, resvg.render().asPng())
  console.log(`✓ ${outPath} (${size}x${size})`)
}

render(512, path.join(iconsDir, 'icon-512.png'))
render(192, path.join(iconsDir, 'icon-192.png'))
console.log('Done!')
