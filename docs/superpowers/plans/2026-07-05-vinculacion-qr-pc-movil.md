# Vinculación efímera PC ↔ móvil por QR — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la misma cuenta de la planilla funcione en teléfono y PC vinculando la PC por QR (estilo WhatsApp Web), con el sueldo nunca llegando a la PC, sesión de 1 día con logout, y sync bidireccional última-escritura-gana.

**Architecture:** El teléfono es dueño de la cuenta. El respaldo de nube se parte en dos secciones cifradas con claves distintas (`shared` = registros + config sin sueldo; `salary` = sueldo + código, solo teléfono). La PC obtiene, por un handshake E2E (ECDH P-256), solo la clave `K_shared`; lee/escribe únicamente la sección `shared`. Sin backend nuevo; solo Firestore + WebCrypto nativo.

**Tech Stack:** React 19 + Vite 8 + TypeScript 6, Dexie/IndexedDB, `firebase/firestore/lite`, WebCrypto (`crypto.subtle`), `qrcode` (generación, ya presente), `jsQR` (nuevo, escaneo), `vitest` (nuevo, tests de funciones puras).

**Spec:** `docs/superpowers/specs/2026-07-05-vinculacion-qr-pc-movil-design.md`

**Convenciones de crypto (fijadas):**
- Salts de sección **deterministas** derivados del `credKey`, para que `K_shared`/`K_salary` sean **estables** entre subidas (así la `K_shared` cacheada en la PC sigue sirviendo aunque el teléfono re-suba). IV siempre aleatorio por cifrado.
  - `saltShared = SHA-256(credKey + "|shared")[0:16]`
  - `saltSalary = SHA-256(credKey + "|salary")[0:16]`
- `K_shared` se deriva como **32 bytes crudos** (`deriveBits`) para poder mandarse a la PC; la PC los importa como clave AES-GCM. `K_salary` nunca sale del teléfono.

---

## File Structure

Nuevos:
- `src/lib/device.ts` — detección teléfono vs PC (`isMobilePhone`).
- `src/lib/backup-split.ts` — puro: `SALARY_FIELDS`, `partirSettings`, `combinarSettings`.
- `src/lib/pairing.ts` — handshake E2E (ECDH/HKDF/AES-GCM), payload QR, grant, polling.
- `src/lib/pc-session.ts` — persistencia/expiración de la sesión de PC en localStorage.
- `src/components/PairGate.tsx` — gate de PC (cuenta nueva / ingresar desde teléfono).
- `src/components/EscanearPCQR.tsx` — escáner de cámara (teléfono).
- `vitest.config.ts` + `src/lib/*.test.ts` — tests de funciones puras.

Modificados:
- `src/lib/cloud-backup.ts` — crypto de secciones, backup v2, funciones `shared` para PC.
- `src/App.tsx` — gate, gating de sueldo por PC, restauración de sesión + expiración, botones Sincronizar/Logout.
- `src/pages/Settings.tsx` — entrada "Vincular una PC"; ocultar card de sueldo y "Restaurar de la nube" en PC.
- `src/pages/ProyeccionSalarial.tsx` — defensa `!isMobilePhone()`.
- `firestore.rules` — colección `pairing` + shape v2 de `backups`.
- `src/version.ts` — `1.7.5` → `1.7.6`.
- `package.json` — deps `jsQR`, `vitest`; script `test`.

---

## Task 0: Tooling (vitest + jsQR)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Instalar dependencias**

Run:
```bash
cd "C:/dev/sep/planilla-horas"
npm install -D vitest@^3
npm install jsqr@^1.4.0
```

- [ ] **Step 2: Agregar script `test` a `package.json`**

En `"scripts"`, agregar:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node', // WebCrypto (crypto.subtle) está disponible en Node 20+
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Verificar que el runner corre (sin tests aún = 0 tests, exit 0)**

Run: `npm test`
Expected: vitest arranca; "No test files found" o 0 fallos. Exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(pairing): vitest + jsQR para la vinculación PC↔móvil"
```

---

## Task 1: Detección de dispositivo — `src/lib/device.ts`

**Files:**
- Create: `src/lib/device.ts`
- Test: `src/lib/device.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/device.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { esTelefonoPorUA } from './device'

afterEach(() => vi.restoreAllMocks())

describe('esTelefonoPorUA', () => {
  it('detecta Android como teléfono', () => {
    expect(esTelefonoPorUA('Mozilla/5.0 (Linux; Android 14; Pixel) ...')).toBe(true)
  })
  it('detecta iPhone como teléfono', () => {
    expect(esTelefonoPorUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 ...)')).toBe(true)
  })
  it('NO detecta un desktop Windows como teléfono', () => {
    expect(esTelefonoPorUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/device.test.ts`
Expected: FAIL — `esTelefonoPorUA is not a function`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/device.ts
// Detección teléfono-vs-PC. No es perfecta (tablets grandes / laptops touch pueden
// clasificar mal); se acepta el tradeoff. El sueldo queda hard-off si NO es teléfono.

/** Parte testeable: solo mira el user-agent. */
export function esTelefonoPorUA(ua: string): boolean {
  return /Android|iPhone|iPod|Windows Phone|Opera Mini|IEMobile/i.test(ua)
}

/** Heurística completa (usa APIs del navegador). Cachear el resultado en un módulo o estado. */
export function isMobilePhone(): boolean {
  try {
    const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData
    if (uaData?.mobile === true) return true
    const coarse =
      matchMedia('(pointer: coarse)').matches &&
      navigator.maxTouchPoints > 0 &&
      matchMedia('(max-width: 820px)').matches
    if (coarse) return true
    return esTelefonoPorUA(navigator.userAgent)
  } catch {
    return esTelefonoPorUA(navigator.userAgent)
  }
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/device.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/device.ts src/lib/device.test.ts
git commit -m "feat(pairing): isMobilePhone() para gating por dispositivo"
```

---

## Task 2: Split de sueldo — `src/lib/backup-split.ts`

**Files:**
- Create: `src/lib/backup-split.ts`
- Test: `src/lib/backup-split.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/backup-split.test.ts
import { describe, it, expect } from 'vitest'
import { partirSettings, combinarSettings, SALARY_FIELDS } from './backup-split'
import { DEFAULT_SETTINGS } from '../db/database'

const settings = {
  ...DEFAULT_SETTINGS,
  nombreUsuario: 'Juan',
  sueldoBasico: 999999,
  convenio: 'CCT_644_12' as const,
  backupCodigo: '123456',
}

describe('partirSettings', () => {
  it('el sueldo y el código NO están en shared', () => {
    const { shared } = partirSettings(settings)
    for (const f of SALARY_FIELDS) expect(shared).not.toHaveProperty(f)
    expect(shared).not.toHaveProperty('backupCodigo')
    expect(shared.nombreUsuario).toBe('Juan')
  })
  it('el sueldo y el código SÍ están en salary', () => {
    const { salary } = partirSettings(settings)
    expect(salary.sueldoBasico).toBe(999999)
    expect(salary.backupCodigo).toBe('123456')
  })
})

describe('combinarSettings (round-trip)', () => {
  it('reconstruye los settings originales', () => {
    const { shared, salary } = partirSettings(settings)
    expect(combinarSettings(shared, salary)).toEqual(settings)
  })
  it('sin salary, el sueldo queda en defaults (caso PC)', () => {
    const { shared } = partirSettings(settings)
    const soloShared = combinarSettings(shared, {})
    expect(soloShared.sueldoBasico).toBe(DEFAULT_SETTINGS.sueldoBasico) // 0
    expect(soloShared.backupCodigo).toBe('') // el código nunca llega a la PC
    expect(soloShared.nombreUsuario).toBe('Juan')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/backup-split.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/lib/backup-split.ts
// Parte los settings en dos: 'shared' (todo menos sueldo/código) y 'salary' (solo
// sueldo + código de nube). Así el respaldo de nube se cifra en dos secciones con
// claves distintas y la PC solo recibe la clave de 'shared' → el sueldo nunca le llega.
import { DEFAULT_SETTINGS, type AppSettings } from '../db/database'

/** Campos que SOLO viven en la sección 'salary' (phone-only). Incluye el código de nube. */
export const SALARY_FIELDS = [
  'sueldoBasico', 'sueldoBasicoVigenciaMs', 'convenio', 'fechaIngresoMs', 'tipoTurno',
  'zonaVacaMuerta', 'tasaDesarraigo644', 'tieneGuardiaPasiva', 'valorGuardiaDia',
  'adicionalCampoRate', 'bonoPazRate644', 'solidaria644', 'backupCodigo', 'backupBloqueado',
] as const satisfies ReadonlyArray<keyof AppSettings>

type SalaryField = (typeof SALARY_FIELDS)[number]

export function partirSettings(s: AppSettings): {
  shared: Partial<AppSettings>
  salary: Partial<AppSettings>
} {
  const shared: Record<string, unknown> = {}
  const salary: Record<string, unknown> = {}
  const salarySet = new Set<string>(SALARY_FIELDS)
  for (const [k, v] of Object.entries(s)) {
    if (k === 'id') continue
    if (salarySet.has(k)) salary[k] = v
    else shared[k] = v
  }
  return { shared: shared as Partial<AppSettings>, salary: salary as Partial<AppSettings> }
}

export function combinarSettings(
  shared: Partial<AppSettings>, salary: Partial<AppSettings>,
): AppSettings {
  return { ...DEFAULT_SETTINGS, ...shared, ...salary, id: 1 }
}

export type { SalaryField }
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/backup-split.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup-split.ts src/lib/backup-split.test.ts
git commit -m "feat(pairing): split shared/salary de settings (sueldo phone-only)"
```

---

## Task 3: Crypto de secciones + backup v2 en `cloud-backup.ts`

Refactor: el respaldo pasa de un blob único (schema 1) a dos secciones cifradas (schema 2). Se conserva compat de lectura con schema 1.

**Files:**
- Modify: `src/lib/cloud-backup.ts`
- Test: `src/lib/section-crypto.test.ts` (exporta helpers puros para testear el round-trip AES-GCM con WebCrypto de Node)

- [ ] **Step 1: Agregar helpers de crypto de sección (exportados) en `cloud-backup.ts`**

Debajo de `deriveKey` (~L264), agregar. Reusa `bufToB64`, `b64ToBytes`, `bufToB64Url`, `gzip`, `gunzip`, `credKey`, `PBKDF2_ITERATIONS` ya existentes en el archivo:

```ts
// ── Crypto de secciones (backup v2: 'shared' + 'salary') ──────────────────────
// Salt determinista por sección: la clave queda ESTABLE entre subidas, así la
// K_shared que la PC cachea sigue sirviendo aunque el teléfono re-suba.
async function saltSeccion(usuario: string, codigo: string, seccion: 'shared' | 'salary'): Promise<Uint8Array<ArrayBuffer>> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credKey(usuario, codigo) + '|' + seccion))
  return new Uint8Array(h).slice(0, 16)
}

/** Deriva los 32 bytes crudos de la clave de una sección (para poder mandar K_shared a la PC). */
async function deriveSectionBits(usuario: string, codigo: string, seccion: 'shared' | 'salary'): Promise<Uint8Array<ArrayBuffer>> {
  const salt = await saltSeccion(usuario, codigo, seccion)
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(credKey(usuario, codigo)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, material, 256)
  return new Uint8Array(bits)
}

export async function importAesKey(rawKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export interface Seccion { iv: string; data: string; comp?: 'gzip' }

/** Cifra un objeto JSON en una sección {iv,data,comp}. */
export async function cifrarSeccion(key: CryptoKey, obj: unknown): Promise<Seccion> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  let plano: Uint8Array<ArrayBuffer> = new TextEncoder().encode(JSON.stringify(obj))
  let comp: 'gzip' | undefined
  if (soportaCompresion()) { try { plano = await gzip(plano); comp = 'gzip' } catch { /* crudo */ } }
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plano)
  const s: Seccion = { iv: bufToB64(iv.buffer), data: bufToB64(ct) }
  if (comp) s.comp = comp
  return s
}

/** Descifra una sección {iv,data,comp} a objeto. Lanza si la clave no valida. */
export async function descifrarSeccion<T>(key: CryptoKey, s: Seccion): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(s.iv) }, key, b64ToBytes(s.data))
  const bytes = s.comp === 'gzip' ? await gunzip(new Uint8Array(pt)) : new Uint8Array(pt)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
```

- [ ] **Step 2: Test del round-trip de sección**

```ts
// src/lib/section-crypto.test.ts
import { describe, it, expect } from 'vitest'
import { importAesKey, cifrarSeccion, descifrarSeccion } from './cloud-backup'

describe('sección AES-GCM round-trip', () => {
  it('cifra y descifra el mismo objeto', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    const key = await importAesKey(raw)
    const obj = { a: 1, registros: [{ id: 'x' }], settings: [{ nombreUsuario: 'Juan' }] }
    const sec = await cifrarSeccion(key, obj)
    expect(await descifrarSeccion(key, sec)).toEqual(obj)
  })
  it('con clave distinta falla (no leak)', async () => {
    const key1 = await importAesKey(crypto.getRandomValues(new Uint8Array(32)))
    const key2 = await importAesKey(crypto.getRandomValues(new Uint8Array(32)))
    const sec = await cifrarSeccion(key1, { secreto: 42 })
    await expect(descifrarSeccion(key2, sec)).rejects.toBeTruthy()
  })
})
```

Run: `npx vitest run src/lib/section-crypto.test.ts` → PASS (2 tests).

- [ ] **Step 3: Reescribir `subirBackupNube` para escribir schema v2 (dos secciones)**

Reemplazar el cuerpo que construye/sube `payload` (BackupDoc schema 1) por la versión v2. Agregar el tipo `BackupDocV2` junto a `BackupDoc`:

```ts
interface BackupDocV2 {
  schema: 2
  shared: Seccion
  salary: Seccion
  updatedAt: number
  usuario?: string
  linea?: string
}
```

En `subirBackupNube`, tras calcular `huella` y decidir subir, reemplazar el bloque de cifrado único por:

```ts
  const { db } = await import('../db/database')                    // acceso directo a las tablas
  const [registros, settingsArr] = await Promise.all([db.registros.toArray(), db.settings.toArray()])
  const { partirSettings } = await import('./backup-split')
  const settings = settingsArr[0] ?? undefined
  const { shared: shSettings, salary: saSettings } = settings
    ? partirSettings(settings) : { shared: {}, salary: {} }

  const kShared = await importAesKey(await deriveSectionBits(usuario, codigo, 'shared'))
  const kSalary = await importAesKey(await deriveSectionBits(usuario, codigo, 'salary'))
  const shared = await cifrarSeccion(kShared, { version: 1, registros, settings: [shSettings] })
  const salary = await cifrarSeccion(kSalary, { settings: [saSettings] })

  const docId = await computeDocId(usuario, codigo)
  const payload: BackupDocV2 = { schema: 2, shared, salary, updatedAt: Date.now(), usuario: usuario.trim() }
  if (linea?.trim()) payload.linea = linea.trim()
  await setDoc(doc(getDb(), COLLECTION, docId), payload)
```

> Nota: `exportBackupJSON()`/`huellaJSON` se siguen usando para la huella `soloSiCambio` (no cambia). El resto de `subirBackupNube` (padrón, netos, huella, contadores) queda IGUAL.

- [ ] **Step 4: Hacer que `restaurarBackupNube` maneje v1 y v2**

Reemplazar el cuerpo del `try` de `restaurarBackupNube`:

```ts
  const d = snap.data() as Record<string, unknown>
  try {
    if (d.schema === 2) {
      const dv = d as unknown as BackupDocV2
      const kShared = await importAesKey(await deriveSectionBits(usuario, codigo, 'shared'))
      const kSalary = await importAesKey(await deriveSectionBits(usuario, codigo, 'salary'))
      const sh = await descifrarSeccion<{ version: number; registros: unknown[]; settings: Record<string, unknown>[] }>(kShared, dv.shared)
      const sa = await descifrarSeccion<{ settings: Record<string, unknown>[] }>(kSalary, dv.salary)
      const { combinarSettings } = await import('./backup-split')
      const { importBackupJSON } = await import('../db/database')
      const settings = combinarSettings(sh.settings[0] ?? {}, sa.settings[0] ?? {})
      await importBackupJSON(JSON.stringify({ version: 1, registros: sh.registros, settings: [settings] }))
      return 'ok'
    }
    // legado schema 1: blob único
    const legacy = d as unknown as BackupDoc
    const key = await deriveKey(usuario, codigo, b64ToBytes(legacy.salt))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(legacy.iv) }, key, b64ToBytes(legacy.data))
    const bytes = legacy.comp === 'gzip' ? await gunzip(new Uint8Array(pt)) : new Uint8Array(pt)
    await importBackupJSON(new TextDecoder().decode(bytes))
    return 'ok'
  } catch {
    return 'clave-incorrecta'
  }
```

> `verificarBackupNube` / `fechaBackupNube` / `existeBackupNube` siguen sirviendo: solo leen `updatedAt` o intentan descifrar; ajustar `verificarBackupNube` para que, si `schema===2`, descifre la sección `shared` (prueba de propiedad) en vez del blob viejo.

- [ ] **Step 5: Verificar tipos + build**

Run: `npx tsc -b`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cloud-backup.ts src/lib/section-crypto.test.ts
git commit -m "feat(pairing): respaldo v2 con secciones shared/salary cifradas por separado"
```

---

## Task 4: Funciones de nube para la PC (solo `shared`)

**Files:**
- Modify: `src/lib/cloud-backup.ts`

- [ ] **Step 1: Agregar `leerUpdatedAtDoc`, `restaurarSharedDoc`, `subirSharedDoc`**

```ts
// ── API para la PC vinculada: opera SOLO la sección 'shared' con K_shared (bytes crudos) ──
export async function leerUpdatedAtDoc(docId: string): Promise<number | null> {
  const snap = await getDoc(doc(getDb(), COLLECTION, docId))
  contarUso(1, 0)
  return snap.exists() ? ((snap.data() as { updatedAt?: number }).updatedAt ?? null) : null
}

export type ResultadoShared = 'ok' | 'no-existe' | 'incompatible' | 'clave-incorrecta'

/** La PC baja la sección shared y REEMPLAZA sus datos locales (sin sueldo). */
export async function restaurarSharedDoc(docId: string, kSharedRaw: Uint8Array<ArrayBuffer>): Promise<ResultadoShared> {
  const snap = await getDoc(doc(getDb(), COLLECTION, docId)); contarUso(1, 0)
  if (!snap.exists()) return 'no-existe'
  const d = snap.data() as Record<string, unknown>
  if (d.schema !== 2) return 'incompatible' // el teléfono debe migrar (sincronizar) primero
  try {
    const key = await importAesKey(kSharedRaw)
    const sh = await descifrarSeccion<{ version: number; registros: unknown[]; settings: Record<string, unknown>[] }>(key, (d as unknown as BackupDocV2).shared)
    const { combinarSettings } = await import('./backup-split')
    const { importBackupJSON } = await import('../db/database')
    const settings = combinarSettings(sh.settings[0] ?? {}, {}) // sin salary → sueldo en defaults
    await importBackupJSON(JSON.stringify({ version: 1, registros: sh.registros, settings: [settings] }))
    return 'ok'
  } catch { return 'clave-incorrecta' }
}

/** La PC sube SOLO la sección shared (updateDoc), sin tocar el blob 'salary'. */
export async function subirSharedDoc(docId: string, kSharedRaw: Uint8Array<ArrayBuffer>): Promise<number> {
  const { db } = await import('../db/database')
  const [registros, settingsArr] = await Promise.all([db.registros.toArray(), db.settings.toArray()])
  const { partirSettings } = await import('./backup-split')
  const shSettings = settingsArr[0] ? partirSettings(settingsArr[0]).shared : {}
  const key = await importAesKey(kSharedRaw)
  const shared = await cifrarSeccion(key, { version: 1, registros, settings: [shSettings] })
  const updatedAt = Date.now()
  const { updateDoc } = await import('firebase/firestore/lite')
  await updateDoc(doc(getDb(), COLLECTION, docId), { shared, updatedAt }) // NO toca 'salary'
  contarUso(0, 1)
  return updatedAt
}
```

> Importar `updateDoc` de `firebase/firestore/lite` (agregar al import estático del tope o dejar el dynamic import de arriba).

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc -b` → sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cloud-backup.ts
git commit -m "feat(pairing): API de nube para la PC (restaurar/subir solo shared)"
```

---

## Task 5: Handshake E2E — `src/lib/pairing.ts`

**Files:**
- Create: `src/lib/pairing.ts`
- Test: `src/lib/pairing.test.ts`

- [ ] **Step 1: Escribir el test del round-trip E2E**

```ts
// src/lib/pairing.test.ts
import { describe, it, expect } from 'vitest'
import { generarParPC, exportarPub, sellarPermiso, abrirPermiso, type Permiso } from './pairing'

describe('handshake E2E ECDH', () => {
  it('solo la PC (con su privada) puede abrir el permiso', async () => {
    const pc = await generarParPC()
    const pkB64 = await exportarPub(pc.publicKey)
    const permiso: Permiso = { docId: 'doc1', kSharedB64: 'AAAA', usuario: 'Juan' }
    const sobre = await sellarPermiso(pkB64, permiso)          // lo hace el teléfono
    const abierto = await abrirPermiso(pc.privateKey, sobre)   // lo hace la PC
    expect(abierto).toEqual(permiso)
  })
  it('otra PC no puede abrirlo', async () => {
    const pc = await generarParPC(); const otra = await generarParPC()
    const sobre = await sellarPermiso(await exportarPub(pc.publicKey), { docId: 'd', kSharedB64: 'k', usuario: 'u' })
    await expect(abrirPermiso(otra.privateKey, sobre)).rejects.toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/pairing.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/pairing.ts
// Handshake efímero PC↔teléfono (estilo WhatsApp Web): la PC muestra un QR con su
// clave pública ECDH efímera; el teléfono cifra un "permiso" hacia esa clave y lo deja
// en Firestore; solo esa PC (con su privada, en RAM) puede abrirlo.
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore/lite'
import { initializeApp, getApps, getApp } from 'firebase/app'

const firebaseConfig = {
  apiKey: 'AIzaSyCuR0lmbieDncR00XVA2GSQwAjflFIKki0',
  authDomain: 'planillas-backups-986dd.firebaseapp.com',
  projectId: 'planillas-backups-986dd',
  storageBucket: 'planillas-backups-986dd.firebasestorage.app',
  messagingSenderId: '479377881165',
  appId: '1:479377881165:web:e4da9fbdf25c6b374ac404',
}
function db() { return getFirestore(getApps().length ? getApp() : initializeApp(firebaseConfig)) }
const PAIRING = 'pairing'

export interface Permiso { docId: string; kSharedB64: string; usuario: string }
export interface Sobre { pub: string; iv: string; data: string; expiresAt: number; createdAt: number }
export interface PayloadQR { v: 1; sid: string; pk: string }

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function generarParPC(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>
}
export async function exportarPub(pub: CryptoKey): Promise<string> {
  return b64(await crypto.subtle.exportKey('raw', pub))
}
async function importarPub(pkB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(pkB64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
}
async function derivarWrap(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Teléfono: genera su propio par, deriva K_wrap con la pub de la PC y cifra el permiso. */
export async function sellarPermiso(pkPCb64: string, permiso: Permiso): Promise<Sobre> {
  const parTel = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as CryptoKeyPair
  const wrap = await derivarWrap(parTel.privateKey, await importarPub(pkPCb64))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrap, new TextEncoder().encode(JSON.stringify(permiso)))
  return { pub: await exportarPub(parTel.publicKey), iv: b64(iv.buffer), data: b64(ct), expiresAt: 0, createdAt: 0 }
}

/** PC: deriva K_wrap con la pub del teléfono y descifra el permiso. Lanza si no valida. */
export async function abrirPermiso(privPC: CryptoKey, sobre: Sobre): Promise<Permiso> {
  const wrap = await derivarWrap(privPC, await importarPub(sobre.pub))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sobre.iv) }, wrap, unb64(sobre.data))
  return JSON.parse(new TextDecoder().decode(pt)) as Permiso
}

// ── Transporte Firestore (colección efímera `pairing/{sid}`) ─────────────────
export function nuevoSid(): string { return crypto.randomUUID().replace(/-/g, '') }

/** Teléfono: escribe el sobre cifrado. TTL de 2 min para el handshake. */
export async function escribirSobre(sid: string, sobre: Omit<Sobre, 'expiresAt' | 'createdAt'>, ahoraMs: number): Promise<void> {
  await setDoc(doc(db(), PAIRING, sid), { ...sobre, createdAt: ahoraMs, expiresAt: ahoraMs + 120_000 })
}
/** PC: lee el sobre (null si aún no llegó o expiró). */
export async function leerSobre(sid: string, ahoraMs: number): Promise<Sobre | null> {
  const snap = await getDoc(doc(db(), PAIRING, sid))
  if (!snap.exists()) return null
  const s = snap.data() as Sobre
  return s.expiresAt && s.expiresAt < ahoraMs ? null : s
}
/** PC: borra el sobre tras consumirlo. */
export async function borrarSobre(sid: string): Promise<void> {
  try { await deleteDoc(doc(db(), PAIRING, sid)) } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/pairing.test.ts` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pairing.ts src/lib/pairing.test.ts
git commit -m "feat(pairing): handshake E2E ECDH P-256 + transporte Firestore efímero"
```

---

## Task 6: Sesión de PC — `src/lib/pc-session.ts`

**Files:**
- Create: `src/lib/pc-session.ts`
- Test: `src/lib/pc-session.test.ts`

- [ ] **Step 1: Test de la lógica de expiración**

```ts
// src/lib/pc-session.test.ts
import { describe, it, expect } from 'vitest'
import { esValida, renovar, type PCSession } from './pc-session'

const base: PCSession = { docId: 'd', kSharedB64: 'k', usuario: 'Juan', expiresAt: 1000 }

describe('sesión de PC', () => {
  it('válida antes de expirar', () => expect(esValida(base, 999)).toBe(true))
  it('inválida al expirar', () => expect(esValida(base, 1000)).toBe(false))
  it('renovar corre expiresAt 24h desde ahora', () => {
    const r = renovar(base, 5000)
    expect(r.expiresAt).toBe(5000 + 24 * 60 * 60 * 1000)
  })
})
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/lib/pc-session.ts
// Sesión de la PC vinculada: persiste SOLO K_shared (nunca el código ni el sueldo).
// Vigencia 1 día sliding; se renueva con la actividad; logout/expiración la limpian.
const KEY = 'planilla-pc-session'
const DIA_MS = 24 * 60 * 60 * 1000

export interface PCSession {
  docId: string
  kSharedB64: string   // K_shared en base64 (32 bytes); NO es el código
  usuario: string
  expiresAt: number
}

export function esValida(s: PCSession | null, ahoraMs: number): s is PCSession {
  return !!s && typeof s.expiresAt === 'number' && s.expiresAt > ahoraMs
}
export function renovar(s: PCSession, ahoraMs: number): PCSession {
  return { ...s, expiresAt: ahoraMs + DIA_MS }
}

export function cargarSesion(): PCSession | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) as PCSession : null } catch { return null }
}
export function guardarSesion(s: PCSession): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}
export function limpiarSesion(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** Crea la sesión a partir del permiso abierto (K_shared va tal cual, ya en base64). */
export function crearDesdePermiso(p: { docId: string; kSharedB64: string; usuario: string }, ahoraMs: number): PCSession {
  return { docId: p.docId, kSharedB64: p.kSharedB64, usuario: p.usuario, expiresAt: ahoraMs + DIA_MS }
}
```

- [ ] **Step 4: Correr y ver que pasa** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pc-session.ts src/lib/pc-session.test.ts
git commit -m "feat(pairing): sesión de PC persistida (1 día sliding, solo K_shared)"
```

---

## Task 7: Reglas Firestore

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Adaptar la regla de `backups` al shape v2 y agregar `pairing`**

En `firestore.rules`, en el `match /backups/{id}`, aceptar el shape v2 además del v1 (por compat de escritura del teléfono). Cambiar el `allow create, update` para permitir cualquiera de las dos formas:

```
match /backups/{id} {
  allow get: if true;
  allow list: if false;
  allow create, update: if
    // schema 1 (legado)
    (request.resource.data.keys().hasAll(['iv','salt','data','updatedAt'])
      && request.resource.data.data is string
      && request.resource.data.data.size() < 900000)
    // schema 2 (secciones shared/salary)
    || (request.resource.data.schema == 2
      && request.resource.data.keys().hasOnly(['schema','shared','salary','updatedAt','usuario','linea'])
      && request.resource.data.shared.data is string
      && request.resource.data.shared.data.size() < 900000
      && request.resource.data.salary.data is string
      && request.resource.data.salary.data.size() < 200000)
    // update parcial de la PC (solo 'shared' + 'updatedAt')
    || (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['shared','updatedAt'])
      && request.resource.data.shared.data is string
      && request.resource.data.shared.data.size() < 900000);
  allow delete: if true;
}

match /pairing/{sid} {
  allow get: if true;
  allow list: if false;
  allow create, update: if
    request.resource.data.keys().hasOnly(['pub','iv','data','expiresAt','createdAt'])
    && request.resource.data.data is string
    && request.resource.data.data.size() < 20000;
  allow delete: if true;
}
```

> El `update` parcial de la PC entra por la 3.ª rama (solo toca `shared`+`updatedAt`), garantizando que la PC no puede reescribir `salary`.

- [ ] **Step 2: Commit** (la publicación va en el deploy, Task 12)

```bash
git add firestore.rules
git commit -m "feat(pairing): reglas Firestore para backups v2 + colección pairing"
```

---

## Task 8: Gate de PC — `src/components/PairGate.tsx`

Componente a pantalla completa (mismo shell visual que `InstallGate`/`ShareQR`). Dos vistas: elección inicial, panel "cuenta nueva" (QR de instalación) y panel "ingresar desde teléfono" (QR de pairing + polling).

**Files:**
- Create: `src/components/PairGate.tsx`

- [ ] **Step 1: Implementar el componente**

Props: `{ onVinculada: (s: PCSession) => void }`. Lógica clave:
- Estado `vista: 'menu' | 'nueva' | 'pair'`.
- **"Cuenta nueva":** generar QR de instalación con `QRCode.toDataURL(window.location.origin + import.meta.env.BASE_URL, { errorCorrectionLevel:'H', width:360 })` (idéntico a `ShareQR.tsx`); texto "Creá tu cuenta desde el teléfono. Escaneá para instalar la app".
- **"Ingresar desde teléfono":**
  ```ts
  const par = await generarParPC()
  const sid = nuevoSid()
  const pk = await exportarPub(par.publicKey)
  const qr = await QRCode.toDataURL(JSON.stringify({ v:1, sid, pk } satisfies PayloadQR), { errorCorrectionLevel:'M', width:360 })
  // polling cada 2s hasta 2 min:
  const t0 = Date.now()
  const timer = setInterval(async () => {
    if (Date.now() - t0 > 120_000) { clearInterval(timer); setExpirado(true); return }
    const sobre = await leerSobre(sid, Date.now())
    if (!sobre) return
    clearInterval(timer)
    try {
      const permiso = await abrirPermiso(par.privateKey, sobre)
      await borrarSobre(sid)
      const sesion = crearDesdePermiso(permiso, Date.now())
      guardarSesion(sesion)
      const raw = Uint8Array.from(atob(permiso.kSharedB64), c => c.charCodeAt(0))
      const r = await restaurarSharedDoc(permiso.docId, raw as Uint8Array<ArrayBuffer>)
      if (r === 'incompatible') { setError('Sincronizá primero desde el teléfono'); limpiarSesion(); return }
      onVinculada(sesion)
    } catch { setError('No se pudo vincular. Reintentá.') }
  }, 2000)
  ```
- Botón "Regenerar QR" cuando `expirado`.
- Sin emojis (usar íconos `lucide-react` ya presentes, p. ej. `Smartphone`, `QrCode`, `Monitor`). Respetar `feedback_no_emojis_ui`.

- [ ] **Step 2: Verificación manual**

Correr `npm run dev`, abrir en el navegador de escritorio → debe aparecer `PairGate` con las dos opciones. (La vinculación real se prueba end-to-end en Task 12.)

- [ ] **Step 3: Commit**

```bash
git add src/components/PairGate.tsx
git commit -m "feat(pairing): PairGate (cuenta nueva=QR instalación / ingresar desde teléfono)"
```

---

## Task 9: Escáner en el teléfono — `src/components/EscanearPCQR.tsx`

**Files:**
- Create: `src/components/EscanearPCQR.tsx`
- Modify: `src/pages/Settings.tsx` (entrada "Vincular una PC")

- [ ] **Step 1: Implementar el escáner**

Props: `{ usuario: string; codigo: string; onClose: () => void }`. Lógica:
```ts
const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
// pintar en <video>, capturar frames a un <canvas> con requestAnimationFrame,
// decodificar con jsQR:
import jsQR from 'jsqr'
const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
const code = jsQR(img.data, img.width, img.height)
if (code) { onDetect(code.data) }
```
Al detectar, parsear `PayloadQR`, mostrar confirmación "¿Vincular esta PC? Podrá ver y editar tus horas, sin el sueldo." y al confirmar:
```ts
const docId = await miDocIdNube(usuario, codigo)
const kSharedRaw = await deriveSectionBits(usuario, codigo, 'shared') // NECESITA export (ver nota)
const kSharedB64 = btoa(String.fromCharCode(...kSharedRaw))
const sobre = await sellarPermiso(payload.pk, { docId, kSharedB64, usuario })
await escribirSobre(payload.sid, sobre, Date.now())
// además: asegurar que el doc está en v2 (subir un backup si hiciera falta)
await subirBackupNube(usuario, codigo, undefined, { soloSiCambio: true })
```
> **Nota:** exportar `deriveSectionBits` desde `cloud-backup.ts` (hoy es privada). Cambiar `async function deriveSectionBits` → `export async function deriveSectionBits`.

Manejo de: permiso de cámara denegado, sin cámara (`getUserMedia` throw), y liberar el stream (`track.stop()`) en `onClose`/unmount. Fallback opcional `BarcodeDetector` si existe.

- [ ] **Step 2: Entrada en Settings (solo teléfono)**

En `Settings.tsx`, en la sección de nube/cuenta, agregar un botón "Vincular una PC" visible solo si `isMobilePhone()` que abre `EscanearPCQR` con el `usuario`/`codigo` actuales.

- [ ] **Step 3: Verificación manual**

En un teléfono real (o dev con cámara), Settings → "Vincular una PC" pide permiso de cámara y muestra el visor.

- [ ] **Step 4: Commit**

```bash
git add src/components/EscanearPCQR.tsx src/pages/Settings.tsx
git commit -m "feat(pairing): escáner de QR en el teléfono (jsQR) + entrada en Settings"
```

---

## Task 10: Integración en `App.tsx` (gate, sesión, gating de sueldo, botones)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Estado de sesión de PC + detección**

Cerca de los otros `useState` de `AppContent`:
```ts
const esTelefono = useMemo(() => isMobilePhone(), [])
const [pcSesion, setPcSesion] = useState<PCSession | null>(() => {
  const s = cargarSesion(); return esValida(s, Date.now()) ? s : (limpiarSesion(), null)
})
```

- [ ] **Step 2: Early-return del `PairGate` (junto a `InstallGate`, ~L461)**

```tsx
if (!esTelefono && !pcSesion) {
  return <PairGate onVinculada={(s) => setPcSesion(s)} />
}
```

- [ ] **Step 3: Timer de expiración 24h sliding + renovación por actividad**

`useEffect` que, si `pcSesion`, registra listeners de actividad (`pointerdown`, `keydown`) que hacen `renovar` (throttled a 1/min) + `guardarSesion`, y un `setInterval` (cada 60s) que si `!esValida(pcSesion, Date.now())` → logout (limpiar sesión + `clearAllRegistros` + `setPcSesion(null)`).

- [ ] **Step 4: Hard-off de sueldo en PC**

En los 3 puntos (init `showSalary`, render tab, render contenido) envolver con `esTelefono &&`. Ej. init:
```ts
const [showSalary, setShowSalary] = useState<boolean>(
  esTelefono && (localStorage.getItem(SALARY_UNLOCK_KEY) === '1' || salarioDesbloqueadoNube())
)
```
y el tab `salary` y su contenido: `esTelefono && showSalary && ...`.

- [ ] **Step 5: Botones "Sincronizar datos" y "Logout" (solo PC)**

Barra/acciones visibles cuando `pcSesion` (p. ej. en la pantalla de horas o el nav):
```ts
async function sincronizarPC() {
  const raw = Uint8Array.from(atob(pcSesion!.kSharedB64), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
  const cloudTs = await leerUpdatedAtDoc(pcSesion!.docId)
  const localTs = Number(localStorage.getItem('planilla-pc-last-sync') ?? 0)
  if (cloudTs && cloudTs > localTs) {
    await restaurarSharedDoc(pcSesion!.docId, raw)        // nube más nueva → bajar
    localStorage.setItem('planilla-pc-last-sync', String(cloudTs))
  } else {
    const ts = await subirSharedDoc(pcSesion!.docId, raw) // local más nuevo → subir
    localStorage.setItem('planilla-pc-last-sync', String(ts))
  }
  // recargar la vista de datos (reusar el reload que ya usan los hooks)
}
function logoutPC() {
  limpiarSesion(); void clearAllRegistros(); setPcSesion(null)
}
```
Sin emojis; usar íconos lucide (`RefreshCw`, `LogOut`).

- [ ] **Step 6: Build**

Run: `npx tsc -b && npm run build`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(pairing): gate/sesión de PC, sueldo hard-off en PC, botones sincronizar/logout"
```

---

## Task 11: Settings + ProyeccionSalarial (gating de sueldo / restaurar en PC)

**Files:**
- Modify: `src/pages/Settings.tsx`, `src/pages/ProyeccionSalarial.tsx`

- [ ] **Step 1: `ProyeccionSalarial.tsx` — defensa por dispositivo**

En el guard del tope (~L31) sumar `!isMobilePhone()`:
```ts
if (!isMobilePhone() || !(isSalaryUser(settings.nombreUsuario) || salarioDesbloqueadoNube())) return <Oculta/>
```

- [ ] **Step 2: `Settings.tsx` — ocultar card de sueldo y "Restaurar de la nube" en PC**

- Card "Salario y convenio" (~L636): condicionar además con `isMobilePhone() &&`.
- Botón/opción "Restaurar de la nube": envolver con `isMobilePhone() &&` (en PC no existe; se restaura al vincular y con "Sincronizar").

- [ ] **Step 3: Build**

Run: `npx tsc -b && npm run build` → OK.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx src/pages/ProyeccionSalarial.tsx
git commit -m "feat(pairing): ocultar sueldo y restaurar-de-nube en PC"
```

---

## Task 12: Versión, verificación integral y deploy 1.7.6

**Files:**
- Modify: `src/version.ts`

- [ ] **Step 1: Bump de versión**

`src/version.ts`: `export const APP_VERSION = '1.7.6'`

- [ ] **Step 2: Suite de tests + lint + build**

Run:
```bash
npm test
npm run lint
npm run build
```
Expected: tests PASS, lint sin errores nuevos, build OK.

- [ ] **Step 3: Verificación end-to-end manual (crítica)**

Con `npm run preview` (o dev) y un teléfono:
1. En PC: aparece `PairGate`. "Ingresar desde teléfono" muestra QR.
2. En teléfono (cuenta ya configurada): Settings → "Vincular una PC" → escanear → confirmar.
3. PC entra sin pestaña de sueldo; **verificar en DevTools que el IndexedDB de la PC NO tiene sueldo** (`settings.sueldoBasico === 0`, `backupCodigo === ''`).
4. Editar un día en PC → "Sincronizar" → en teléfono "Sincronizar" → aparece el cambio. Y viceversa.
5. Logout en PC → vuelve `PairGate` y el IndexedDB queda limpio.
6. El sueldo en el teléfono sigue intacto tras varias syncs de la PC.

- [ ] **Step 4: Commit del bump**

```bash
git add src/version.ts
git commit -m "chore(planilla): v1.7.6 — vinculación efímera PC↔móvil por QR"
```

- [ ] **Step 5: Publicar reglas Firestore** (requiere acceso Firebase del usuario)

```bash
# opción CLI (si hay firebase-tools y login):
npx firebase-tools deploy --only firestore:rules --project planillas-backups-986dd
```
> Si no hay CLI/login, pegar `firestore.rules` en la consola de Firebase → Firestore → Rules → Publish. **Sin esto, el teléfono no puede subir backups v2 ni escribir `pairing`.**

- [ ] **Step 6: Deploy (merge a `main` + push → GitHub Pages)**

```bash
git checkout main
git merge --no-ff feature/vinculacion-qr-pc-movil
git push origin main   # dispara el workflow de GH Pages
```
Verificar el Actions workflow en verde y la PWA publicada sirviendo 1.7.6.

---

## Self-Review (cobertura del spec)

- §5.1 detección → Task 1 ✅
- §5.2 gate PC (cuenta nueva=QR instalación / ingresar desde teléfono) → Task 8 ✅ (D4)
- §5.3 respaldo partido v2 → Tasks 2, 3 ✅
- §5.4 handshake E2E → Task 5 ✅
- §5.5 sesión 1 día + logout → Tasks 6, 10 ✅
- §5.6 sincronizar (última-sync-gana) + sin restaurar en PC → Tasks 10, 11 ✅
- §5.7 sueldo hard-off en PC → Tasks 10, 11 ✅ (D1)
- §5.8 escáner jsQR → Task 9 ✅
- §6 reglas Firestore (pairing + backups v2) → Tasks 7, 12 ✅
- §7 deps (jsQR) → Task 0 ✅
- §10 testing (vitest puras) → Tasks 1,2,3,5,6 ✅
- Deploy 1.7.6 → Task 12 ✅
