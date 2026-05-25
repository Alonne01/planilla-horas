import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#071a2e"/>
    <stop offset="100%" stop-color="#0c1e30"/>
  </linearGradient>
  <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#5ee8e2"/>
    <stop offset="100%" stop-color="#29a09a"/>
  </linearGradient>
  <linearGradient id="hairShad" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#3dd0c8"/>
    <stop offset="100%" stop-color="#1e7d78"/>
  </linearGradient>
  <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#fde8da"/>
    <stop offset="100%" stop-color="#f5ccba"/>
  </linearGradient>
  <radialGradient id="iris" cx="40%" cy="35%" r="60%">
    <stop offset="0%" stop-color="#7af0ea"/>
    <stop offset="60%" stop-color="#39C5BB"/>
    <stop offset="100%" stop-color="#1e8a85"/>
  </radialGradient>
</defs>

<!-- Background rounded square -->
<rect width="512" height="512" rx="88" ry="88" fill="url(#bg)"/>

<!-- Ambient teal glow top -->
<ellipse cx="256" cy="90" rx="190" ry="70" fill="#39C5BB" opacity="0.07"/>

<!-- ===== TWIN TAILS (behind body) ===== -->
<!-- Left tail body -->
<path d="M 145 208 Q 92 258 74 345 Q 60 415 88 458 Q 106 474 126 456 Q 112 422 117 368 Q 122 308 155 258 Q 170 232 182 215 Z" fill="url(#hair)"/>
<!-- Left tail inner sheen -->
<path d="M 153 214 Q 108 265 96 352 Q 89 398 103 442 Q 115 428 116 390 Q 118 340 145 272 Z" fill="#7af0ea" opacity="0.35"/>
<!-- Left tail edge shadow -->
<path d="M 180 218 Q 172 230 162 252 Q 148 292 142 340 Q 138 380 145 415 Q 125 415 120 368 Q 122 308 155 258 Q 168 234 180 218 Z" fill="#1e7d78" opacity="0.5"/>

<!-- Right tail body -->
<path d="M 367 208 Q 420 258 438 345 Q 452 415 424 458 Q 406 474 386 456 Q 400 422 395 368 Q 390 308 357 258 Q 342 232 330 215 Z" fill="url(#hair)"/>
<!-- Right tail inner sheen -->
<path d="M 359 214 Q 404 265 416 352 Q 423 398 409 442 Q 397 428 396 390 Q 394 340 367 272 Z" fill="#7af0ea" opacity="0.35"/>
<!-- Right tail edge shadow -->
<path d="M 332 218 Q 340 230 350 252 Q 364 292 370 340 Q 374 380 367 415 Q 387 415 392 368 Q 390 308 357 258 Q 344 234 332 218 Z" fill="#1e7d78" opacity="0.5"/>

<!-- Hair ties -->
<ellipse cx="154" cy="209" rx="24" ry="17" fill="#39C5BB" transform="rotate(-18 154 209)"/>
<ellipse cx="358" cy="209" rx="24" ry="17" fill="#39C5BB" transform="rotate(18 358 209)"/>
<ellipse cx="154" cy="209" rx="13" ry="9"  fill="#081928" transform="rotate(-18 154 209)"/>
<ellipse cx="358" cy="209" rx="13" ry="9"  fill="#081928" transform="rotate(18 358 209)"/>
<ellipse cx="148" cy="204" rx="6" ry="4" fill="#7af0ea" opacity="0.7" transform="rotate(-18 148 204)"/>
<ellipse cx="364" cy="204" rx="6" ry="4" fill="#7af0ea" opacity="0.7" transform="rotate(18 364 204)"/>

<!-- ===== HEAD ===== -->
<ellipse cx="256" cy="222" rx="102" ry="108" fill="url(#skin)"/>
<ellipse cx="178" cy="240" rx="20" ry="50" fill="#e8b89e" opacity="0.25"/>
<ellipse cx="334" cy="240" rx="20" ry="50" fill="#e8b89e" opacity="0.25"/>

<!-- ===== HAIR TOP (front) ===== -->
<path d="
  M 158 200
  Q 158 132 182 115
  Q 200 104 218 118
  Q 221 140 222 162
  Q 230 136 238 118
  Q 247 107 256 105
  Q 265 107 274 118
  Q 282 136 290 162
  Q 291 140 294 118
  Q 312 104 330 115
  Q 354 132 354 200
  Q 330 170 315 158
  Q 296 146 276 153
  Q 266 157 256 157
  Q 246 157 236 153
  Q 216 146 197 158
  Q 182 170 158 200 Z"
  fill="url(#hair)"/>

<!-- Bangs -->
<path d="M 178 196 Q 190 166 215 171 Q 209 192 208 215 Z" fill="url(#hairShad)" opacity="0.92"/>
<path d="M 202 182 Q 218 160 244 167 Q 234 186 232 210 Z" fill="url(#hair)" opacity="0.88"/>
<path d="M 334 196 Q 322 166 297 171 Q 303 192 304 215 Z" fill="url(#hairShad)" opacity="0.92"/>
<path d="M 310 182 Q 294 160 268 167 Q 278 186 280 210 Z" fill="url(#hair)" opacity="0.88"/>

<!-- Side hair flaps -->
<path d="M 160 206 Q 148 220 148 248 Q 148 278 158 300 Q 163 278 166 256 Q 168 230 174 214 Z" fill="url(#hair)"/>
<path d="M 352 206 Q 364 220 364 248 Q 364 278 354 300 Q 349 278 346 256 Q 344 230 338 214 Z" fill="url(#hair)"/>

<!-- ===== FACE ===== -->
<!-- Eye whites -->
<ellipse cx="216" cy="240" rx="29" ry="24" fill="white"/>
<ellipse cx="296" cy="240" rx="29" ry="24" fill="white"/>
<!-- Eyelid top shadow -->
<ellipse cx="216" cy="226" rx="29" ry="10" fill="#d0e8f8" opacity="0.45"/>
<ellipse cx="296" cy="226" rx="29" ry="10" fill="#d0e8f8" opacity="0.45"/>
<!-- Iris -->
<ellipse cx="216" cy="243" rx="20" ry="21" fill="url(#iris)"/>
<ellipse cx="296" cy="243" rx="20" ry="21" fill="url(#iris)"/>
<!-- Iris lower shade -->
<ellipse cx="216" cy="252" rx="20" ry="12" fill="#1a6560" opacity="0.55"/>
<ellipse cx="296" cy="252" rx="20" ry="12" fill="#1a6560" opacity="0.55"/>
<!-- Pupil -->
<ellipse cx="217" cy="244" rx="10" ry="13" fill="#071a2e"/>
<ellipse cx="297" cy="244" rx="10" ry="13" fill="#071a2e"/>
<!-- Eye shine main -->
<ellipse cx="209" cy="234" rx="6" ry="6" fill="white" opacity="0.96"/>
<ellipse cx="289" cy="234" rx="6" ry="6" fill="white" opacity="0.96"/>
<!-- Eye shine small -->
<ellipse cx="226" cy="251" rx="3.5" ry="3.5" fill="white" opacity="0.7"/>
<ellipse cx="306" cy="251" rx="3.5" ry="3.5" fill="white" opacity="0.7"/>
<!-- Eyelashes top -->
<path d="M 190 224 Q 206 213 228 218 Q 238 215 242 220" stroke="#1a2535" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="M 270 220 Q 280 215 302 213 Q 316 218 322 224" stroke="#1a2535" stroke-width="4" fill="none" stroke-linecap="round"/>
<!-- Eyelashes bottom -->
<path d="M 192 257 Q 208 265 234 262 Q 240 263 242 259" stroke="#2a3a4a" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.55"/>
<path d="M 270 259 Q 276 263 296 262 Q 314 265 320 257" stroke="#2a3a4a" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.55"/>
<!-- Nose hint -->
<path d="M 250 268 Q 256 275 262 268" stroke="#d09888" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<!-- Smile -->
<path d="M 232 284 Q 256 302 280 284" stroke="#cc6050" stroke-width="4" fill="none" stroke-linecap="round"/>
<!-- Blush -->
<ellipse cx="194" cy="268" rx="24" ry="13" fill="#ff9eb5" opacity="0.38"/>
<ellipse cx="318" cy="268" rx="24" ry="13" fill="#ff9eb5" opacity="0.38"/>

<!-- ===== NECK ===== -->
<rect x="232" y="316" width="48" height="36" rx="8" fill="url(#skin)"/>

<!-- ===== SHIRT COLLAR ===== -->
<path d="M 188 350 Q 204 326 234 320 L 256 338 L 278 320 Q 308 326 324 350 L 286 343 L 256 362 L 226 343 Z" fill="#0c2a3c" stroke="#39C5BB" stroke-width="2.5"/>
<path d="M 234 320 L 256 338 L 278 320 L 256 342 Z" fill="#112e40" opacity="0.7"/>
<!-- Tie -->
<path d="M 248 324 L 256 378 L 264 324 L 260 330 L 256 344 L 252 330 Z" fill="#39C5BB"/>

<!-- ===== CALENDAR BADGE (bottom right) ===== -->
<rect x="316" y="362" width="156" height="122" rx="18" fill="#39C5BB" opacity="0.18"/>
<rect x="312" y="358" width="156" height="122" rx="18" fill="#091828" stroke="#39C5BB" stroke-width="3"/>
<rect x="312" y="358" width="156" height="34" rx="18" fill="#39C5BB"/>
<rect x="312" y="374" width="156" height="18" fill="#39C5BB"/>
<text x="390" y="382" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#071a2e" text-anchor="middle" dominant-baseline="middle">HORAS</text>
<!-- Day labels -->
<text x="340" y="403" font-family="Arial" font-size="10" fill="#39C5BB" text-anchor="middle" opacity="0.7">L</text>
<text x="362" y="403" font-family="Arial" font-size="10" fill="#39C5BB" text-anchor="middle" opacity="0.7">M</text>
<text x="384" y="403" font-family="Arial" font-size="10" fill="#39C5BB" text-anchor="middle" opacity="0.7">M</text>
<text x="406" y="403" font-family="Arial" font-size="10" fill="#39C5BB" text-anchor="middle" opacity="0.7">J</text>
<text x="428" y="403" font-family="Arial" font-size="10" fill="#39C5BB" text-anchor="middle" opacity="0.7">V</text>
<text x="450" y="403" font-family="Arial" font-size="10" fill="#39C5BB" text-anchor="middle" opacity="0.7">S</text>
<!-- Row 1 dots -->
<circle cx="340" cy="422" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="362" cy="422" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="384" cy="422" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="406" cy="422" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="428" cy="422" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="450" cy="422" r="9" fill="#39C5BB" opacity="0.25"/>
<!-- Row 2 dots - today highlighted -->
<circle cx="340" cy="447" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="362" cy="447" r="11" fill="#5ee8e2"/>
<text x="362" y="451" font-family="Arial" font-size="11" font-weight="bold" fill="#071a2e" text-anchor="middle">v</text>
<circle cx="384" cy="447" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="406" cy="447" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="428" cy="447" r="9" fill="#39C5BB" opacity="0.45"/>
<circle cx="450" cy="447" r="9" fill="#39C5BB" opacity="0.2"/>
<!-- Row 3 dots -->
<circle cx="340" cy="469" r="9" fill="#39C5BB" opacity="0.25"/>
<circle cx="362" cy="469" r="9" fill="#39C5BB" opacity="0.25"/>
<circle cx="384" cy="469" r="9" fill="#39C5BB" opacity="0.25"/>

<!-- Sparkles -->
<circle cx="42"  cy="42"  r="2" fill="#39C5BB" opacity="0.5"/>
<circle cx="80"  cy="28"  r="1.5" fill="#7af0ea" opacity="0.4"/>
<circle cx="470" cy="55"  r="2" fill="#39C5BB" opacity="0.5"/>
<circle cx="490" cy="35"  r="1.5" fill="#7af0ea" opacity="0.4"/>
<circle cx="30"  cy="470" r="2" fill="#39C5BB" opacity="0.4"/>
<circle cx="488" cy="440" r="1.5" fill="#7af0ea" opacity="0.35"/>
</svg>`

function render(svgStr, size, outPath) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  })
  const png = resvg.render()
  writeFileSync(outPath, png.asPng())
  console.log(`✓ ${outPath} (${size}x${size})`)
}

const iconsDir = path.resolve(__dirname, '../public/icons')
render(svg, 512, path.join(iconsDir, 'icon-512.png'))
render(svg, 192, path.join(iconsDir, 'icon-192.png'))
console.log('Done!')
