# Vinculación efímera PC ↔ móvil por QR (estilo WhatsApp Web)

**Fecha:** 2026-07-05
**Proyecto:** planilla-horas (PWA React 19 + Vite + Firebase/Firestore)
**Rama:** `feature/vinculacion-qr-pc-movil`

## 1. Objetivo

Permitir usar la misma cuenta en teléfono y PC. El teléfono es el dueño de la
cuenta; la PC es un **dispositivo compañero efímero**. Al abrir la app en una PC
por primera vez, se ofrece:

1. **Cuenta nueva** → muestra el **QR de instalación** de la app para el
   teléfono (no se crean cuentas desde la PC).
2. **Ingresar desde teléfono** → muestra un **QR de emparejamiento único** que
   se escanea desde la app del teléfono para vincular la cuenta a la PC.

Los cambios hechos en la PC se ven en el móvil y viceversa, sincronizados con un
botón **"Sincronizar datos"**. El **cálculo salarial es visible solo desde el
teléfono**. La vinculación **dura hasta 1 día o hasta cerrar sesión** (botón
**Logout** en la PC); pasado ese plazo o al hacer logout hay que reescanear el
QR. El sueldo y el código de nube nunca llegan a la PC.

## 2. Decisiones tomadas (fijadas con el usuario)

- **D1 — Sueldo: nunca llega a la PC.** Los campos salariales se filtran en
  origen; ni siquiera quedan en el navegador de la PC. Al sincronizar de vuelta,
  la PC nunca pisa el sueldo del teléfono.
- **D2 — Sesión: hasta 1 día o hasta logout.** El permiso se persiste con
  `expiresAt = últimaActividad + 24 h` (sliding) y sobrevive recargas. Se termina
  por: **logout explícito** (botón en la PC), expiración (1 día sin actividad).
  **Solo persiste `K_shared`** (clave de la sección sin sueldo); el sueldo y el
  `backupCodigo` **nunca** se guardan en la PC. Trade-off aceptado: durante la
  vigencia, quien use esa PC puede ver/editar las horas (no el sueldo).
- **D3 — Conflictos: última sync gana.** Snapshot por marca de tiempo
  (`updatedAt`): el dispositivo que sincroniza último gana. Sin merge por
  registro. Riesgo aceptado: cambios concurrentes sin sync intermedia se pisan.
- **D4 — La PC no puede crear cuentas.** "Cuenta nueva" en la PC solo muestra el
  QR de instalación para el teléfono.
- **D5 — Enfoque de emparejamiento: respaldo partido + entrega de clave efímera
  E2E** (Enfoque A abajo). Sin backend nuevo. Única dependencia nueva: `jsQR`.

## 3. Arquitectura existente relevante

Hallazgos del relevamiento (para no romper lo que ya funciona):

- **No hay login.** La "cuenta" = `nombreUsuario` + `backupCodigo` (6 dígitos).
  `credKey = "usuario:codigo"` (normalizado) es **a la vez** la dirección del doc
  (`docId = base64url(SHA-256(credKey))`) **y** el material de la clave AES-GCM
  (PBKDF2 100k, salt aleatorio). El código lo es todo.
- **Respaldo actual (`src/lib/cloud-backup.ts`):** un único doc
  `backups/{docId}` con `{iv, salt, data, updatedAt, schema:1, comp, usuario,
  linea}`. `data` = AES-GCM(gzip(`exportBackupJSON()`)). `exportBackupJSON()`
  (`src/db/database.ts`) = `{version, registros, settings}` — **el sueldo y el
  propio `backupCodigo` viven dentro de `settings`**. `importBackupJSON()`
  **reemplaza** (borra y reescribe), no mergea. Usa `firebase/firestore/lite`
  (sin listeners en tiempo real).
- **Datos a sincronizar:** las dos tablas Dexie `registros` (un día por fila) y
  `settings` (singleton `id:1`). DB `PlanillaHorasDB` version 1.
- **Sueldo ya atado a un dispositivo (TOFU):** `deviceIdLocal()` (UUID no
  exportado) + `salaryDeviceId`/`salaryConflict` en `mensajes/{docId}`. Un
  restore ingenuo en la PC dispararía `revocarSalaryConflicto` y **apagaría el
  sueldo en ambos lados**. El flujo de emparejamiento **no debe** ejecutar ese
  camino.
- **Gate de primera carga:** `InstallGate` hace early-return en `App.tsx`
  (~L461-463) tras todos los hooks, con `isStandalone()`. Punto de enganche del
  nuevo gate.
- **Navegación:** sin router. `const [tab, setTab] = useState<Tab>("horas")` con
  `Tab = "horas"|"analytics"|"settings"|"salary"|"admin"`; render condicional.
- **Sueldo — puntos de gating (todos deben sumar el check de PC):**
  (1) init `showSalary` (`App.tsx` ~L79), (2) render del tab en el nav
  (`App.tsx` ~L606), (3) render del contenido (`App.tsx` ~L577),
  (4) defensa en `ProyeccionSalarial.tsx` (~L31), (5) card de sueldo en
  `Settings.tsx` (~L636).
- **QR:** `ShareQR.tsx` **genera** (lib `qrcode`) un QR de la URL de la app.
  **No existe escaneo** (ni cámara, ni `BarcodeDetector`, ni decoder). Hay que
  construir el escáner. iOS Safari **no** tiene `BarcodeDetector` → decoder JS.
- **Detección de dispositivo:** solo existe `isStandalone()` (PWA instalada) y
  sniffing de UA por familia de SO. **No hay** detección real teléfono-vs-PC.
- **Reglas Firestore:** modelo "quien conoce el docId, accede". Débiles
  (`allow delete: if true`, create/update solo por forma). El emparejamiento no
  las amplía: el permiso viaja **cifrado E2E**, así que un lector del doc no
  obtiene nada útil.

## 4. Modelo de seguridad / amenaza

- **Sueldo inaccesible para la PC por diseño (no por obfuscación).** La PC solo
  recibe una clave (`K_shared`) que descifra la sección sin sueldo. La sección
  `salary` se cifra con `K_salary`, que **nunca** sale del teléfono. Aunque la PC
  lea el doc de nube completo, la sección `salary` es un blob opaco.
- **Permiso E2E.** El "permiso" que el teléfono deja en Firestore va cifrado con
  ECDH(clave pública efímera de la PC). Solo esa PC (que tiene la privada en RAM)
  puede descifrarlo. Un tercero que lea `pairing/{sid}` no obtiene nada.
- **Alcance de la sesión.** La PC persiste **solo** `K_shared` (+ `docId`,
  `usuario`, `expiresAt`) en `localStorage`, con vigencia de 1 día sliding o hasta
  logout. **Nunca** persiste el `backupCodigo` ni `K_salary`. La privada ECDH del
  handshake es efímera (solo dura el emparejamiento). Trade-off: durante la
  vigencia, la sesión sobrevive recargas y quien use esa PC ve/edita horas (no el
  sueldo); logout o expiración la terminan y limpian la data local.
- **Amenaza residual aceptada.** Quien vea físicamente el QR de la pantalla de la
  PC podría intentar responder el handshake con datos falsos (spoof/DoS), pero
  **no** puede exfiltrar la cuenta (necesita la autorización del teléfono, que es
  quien tiene los datos). Umbral aceptable para una app personal de planilla.
- **No se tocan** las debilidades preexistentes de reglas Firestore (fuera de
  alcance); la nueva colección `pairing` se agrega con reglas acotadas.

## 5. Diseño detallado (Enfoque A)

### 5.1 Detección de dispositivo — `isMobilePhone()`

Nuevo helper (p. ej. `src/lib/device.ts`):

```
esTelefono = (navigator.userAgentData?.mobile === true)
          || (matchMedia('(pointer: coarse)').matches
              && navigator.maxTouchPoints > 0
              && matchMedia('(max-width: 820px)').matches)
          || /Android|iPhone|iPod/i.test(navigator.userAgent);
```

Se acepta el tradeoff (tablets grandes / laptops touch pueden clasificar mal).
El sueldo queda **hard-off en cualquier dispositivo que no sea teléfono**,
independientemente de los flags de desbloqueo.

### 5.2 Gate de primera carga en PC — `PairGate`

Nuevo componente con early-return en `App.tsx`, junto a `InstallGate`, guardado
por `!isMobilePhone()` y por no tener sesión efímera activa. Dos acciones:

- **"Cuenta nueva"** → abre un panel con el **QR de instalación** (reusa la
  lógica de `ShareQR`: `QRCode.toDataURL(SHARE_URL, ...)`) y el texto: *"Creá tu
  cuenta desde el teléfono. Escaneá este código para instalar la app."* No hay
  alta de cuenta en la PC.
- **"Ingresar desde teléfono"** → inicia el handshake (5.4) y muestra el QR de
  emparejamiento + estado ("Esperando escaneo…").

En un **teléfono**, `PairGate` no aparece: la app arranca normal.

### 5.3 Respaldo partido — schema v2

`backups/{docId}` pasa a:

```
{
  schema: 2,
  shared: { iv, salt, data },   // AES-GCM_KShared(gzip({version, registros, settingsSinSueldo}))
  salary: { iv, salt, data },   // AES-GCM_KSalary(gzip({ ...camposSueldo, backupCodigo, backupBloqueado }))
  updatedAt, usuario, linea, comp
}
```

- **Derivación de claves** (ambas desde el código, en el teléfono):
  `K_shared = PBKDF2(credKey, salt_shared, 100k)` y
  `K_salary = PBKDF2(credKey, salt_salary, 100k)`. Salts distintos por sección.
- **Campos que salen de `shared` (quedan solo en `salary`, phone-only):**
  `sueldoBasico, sueldoBasicoVigenciaMs, convenio, fechaIngresoMs, tipoTurno,
  zonaVacaMuerta, tasaDesarraigo644, tieneGuardiaPasiva, valorGuardiaDia,
  adicionalCampoRate, bonoPazRate644, solidaria644`, **más** `backupCodigo` y
  `backupBloqueado` (el código de nube es secreto y no debe llegar a la PC).
- **Recomposición:** al restaurar en el teléfono, `settings = { ...shared.settings,
  ...salary.settings }` → idéntico a hoy en la app. La PC recompone solo con
  `shared` (los campos de sueldo quedan en sus defaults 0, sin efecto porque el
  sueldo está hard-off en PC).
- **Compatibilidad:** `restaurar*` reconoce `schema:1` (blob combinado legado, con
  sueldo) y `schema:2`. El teléfono **migra** a v2 en su primer respaldo tras la
  actualización. Un doc v1 legado no permite emparejar hasta que el teléfono
  suba una vez (convierte a v2). Sin pérdida de datos.
- Funciones nuevas/refactor en `cloud-backup.ts`:
  `partirSettings(settings) → { shared, salary }`,
  `combinarSettings(shared, salary) → settings`,
  `subirBackupNube` escribe ambas secciones; `restaurarBackupNube` maneja v1/v2;
  nuevas `restaurarSharedNube(docId, kShared)` y `subirSharedNube(docId, kShared,
  {preservarSalary})` para uso de la PC.

### 5.4 Handshake de emparejamiento (PC muestra / teléfono escanea)

1. **PC** genera `sessionId` (aleatorio) + par ECDH P-256 efímero
   (`crypto.subtle.generateKey`, privada solo en RAM). Construye el payload del
   QR: `{ v:1, sid, pk }` (`pk` = clave pública exportada, raw/base64url).
   Renderiza el QR (lib `qrcode`) y hace **polling** de `pairing/{sid}` cada ~2 s
   hasta 2 min.
2. **Teléfono** (Settings → "Vincular una PC", 5.8): escanea, decodifica el
   payload, muestra confirmación *"¿Vincular esta PC? Podrá ver y editar tus
   horas, sin el sueldo."* Al confirmar:
   - Genera par ECDH efímero, hace `deriveBits`(privada_teléfono, pk_PC) →
     HKDF → `K_wrap` (AES-GCM).
   - Cifra el **permiso** `{ docId, kShared, usuario }` con `K_wrap`.
   - `setDoc(pairing/{sid}, { pub: pk_teléfono, iv, data, expiresAt: now+120s })`.
3. **PC** ve el doc, hace ECDH(privada_PC, pub_teléfono) → `K_wrap`, descifra el
   permiso en RAM, **borra** `pairing/{sid}`, y llama `restaurarSharedNube` para
   cargar la sección `shared` (sin sueldo). Entra a la app en modo sesión
   efímera.

Notas:
- El teléfono debe estar **online al momento del escaneo** (para escribir el
  permiso). Después la PC opera sola contra Firestore.
- `kShared` se transmite en crudo por el canal E2E y vive solo en RAM de la PC;
  no se puede derivar el código a partir de ella.

### 5.5 Sesión de PC (hasta 1 día / logout)

- El permiso (`docId`, `kShared`, `usuario`, `expiresAt`) se persiste en
  `localStorage` bajo una clave dedicada (p. ej. `planilla-pc-session`). **Nunca**
  se guardan el `backupCodigo` ni `K_salary` ni campos de sueldo.
- `expiresAt = últimaActividad + 24 h` (sliding): cada interacción del usuario lo
  renueva. Al abrir la app en la PC, si hay sesión válida y no expirada, entra
  directo (sin reescanear); si expiró, se limpia y vuelve `PairGate`.
- **Logout (botón en la PC):** limpia `planilla-pc-session`, **limpia la data
  local** (`clearAllRegistros` + reset settings) para no dejar rastros de la
  cuenta, y vuelve a `PairGate`. Igual limpieza al expirar.
- La data que la PC edita vive en su IndexedDB local durante la sesión (para
  poder trabajar); la verdad persistente es la nube. En cada emparejamiento y en
  cada "Sincronizar" se refresca desde la nube (por eso no hace falta botón de
  "restaurar" en la PC — ver §5.7).

### 5.6 Botón "Sincronizar datos" (última-sync-gana por timestamp)

Un botón visible en la planilla, en ambos lados:

- Lee `updatedAt` del doc de nube y compara con el `updatedAt` local
  (persistido por dispositivo):
  - **nube más nueva** → baja: reemplaza la data local con la de nube.
  - **local más nuevo** → sube.
- **PC:** solo escribe la sección `shared` (`updateDoc({ shared, updatedAt })`),
  **sin tocar nunca** el blob `salary`. Baja solo `shared`.
- **Teléfono:** escribe/lee ambas secciones (dueño del sueldo).
- Feedback de estado (sincronizando / al día / error) reutilizando patrones de
  toast existentes.

En la PC, junto a "Sincronizar datos" va el botón **Logout** (§5.5). **No** hay
botón de "restaurar de la nube" en la PC: la restauración ocurre en cada
emparejamiento y con "Sincronizar" (la card/opción de restaurar de Settings se
oculta cuando `!isMobilePhone()`).

### 5.7 Sueldo hard-off en PC

Sumar `isMobilePhone()` (negado para PC) a los 5 puntos de gating listados en §3.
Efecto: en PC el tab de sueldo no existe, la ruta `ProyeccionSalarial` devuelve
`Oculta`, y la card de sueldo de Settings no se renderiza — **además** de que la
sección `salary` nunca se descifra en la PC. Doble barrera (UI + datos).

Además, en la PC (`!isMobilePhone()`) se oculta la opción **"Restaurar de la
nube"** de Settings (§5.6): en la PC solo existen "Sincronizar datos" y
"Logout".

### 5.8 Escáner en el teléfono

Nuevo componente `EscanearPCQR.tsx`:

- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
  → `<video>` → captura frames a `<canvas>` → decodifica con **`jsQR`** (pura JS,
  funciona en iOS y Android). Fallback a `BarcodeDetector` si existe (Android) por
  rendimiento.
- Manejo de permisos de cámara (pedir, estados de error, sin cámara).
- Entrada desde **Settings → "Vincular una PC"**.
- Al decodificar un payload `{v:1, sid, pk}` válido → confirmación → escribe el
  permiso (5.4) → "PC vinculada".

## 6. Cambios en Firestore

Nueva colección `pairing/{sid}`:

```
match /pairing/{sid} {
  allow get: if true;                       // la PC lee la respuesta
  allow list: if false;
  allow create, update: if
      request.resource.data.keys().hasOnly(['pub','iv','data','expiresAt','createdAt'])
      && request.resource.data.data is string
      && request.resource.data.data.size() < 20000;
  allow delete: if true;                     // limpieza post-handshake
}
```

`backups/{docId}` mantiene sus reglas de forma actuales, adaptadas al nuevo shape
(secciones `shared`/`salary` en vez de `data` plano); conserva
`get: if true / list: if false`. **No se endurecen** las debilidades
preexistentes (fuera de alcance).

## 7. Dependencias

- **Nueva:** `jsQR` (decoder QR, ~pura JS). `@types` no necesario (trae tipos o
  se declara módulo).
- **Reusadas:** `qrcode` (ya presente, generación), WebCrypto nativo (ECDH P-256,
  HKDF, AES-GCM, PBKDF2 — sin librerías de cripto), `firebase/firestore/lite`.

## 8. Archivos (nuevos / modificados)

Nuevos:
- `src/lib/device.ts` — `isMobilePhone()`.
- `src/lib/pairing.ts` — handshake E2E (ECDH/HKDF), encode/decode del payload QR
  y del permiso, polling.
- `src/lib/pairing-session.ts` (o context) — estado efímero de la sesión de PC +
  timer de inactividad.
- `src/components/PairGate.tsx` — gate de PC (cuenta nueva / ingresar desde tel.).
- `src/components/EscanearPCQR.tsx` — escáner de cámara (teléfono).

Modificados:
- `src/lib/cloud-backup.ts` — schema v2 (partir/combinar sueldo), funciones
  `shared` para PC, compat v1.
- `src/db/database.ts` — helpers de export/import por secciones si hiciera falta.
- `src/App.tsx` — enganche de `PairGate`, gating de sueldo por PC, restauración
  de sesión persistida + timer de expiración (24 h sliding), botones
  "Sincronizar datos" y **"Logout"** (solo PC), limpieza al terminar sesión.
- `src/pages/Settings.tsx` — entrada "Vincular una PC"; gating de card de sueldo;
  **ocultar "Restaurar de la nube" en PC** (`!isMobilePhone()`).
- `src/version.ts` — bump `APP_VERSION` a **1.7.6** para el deploy.
- `src/pages/ProyeccionSalarial.tsx` — defensa `isMobilePhone()`.
- `firestore.rules` — colección `pairing` + shape de `backups` v2.
- `package.json` — `jsQR`.

## 9. Casos borde y compatibilidad

- **Doc de nube v1 legado:** el teléfono lo migra a v2 en su primer respaldo;
  hasta entonces, emparejar avisa "sincronizá primero desde el teléfono".
- **Teléfono offline al escanear:** el permiso no se escribe; la PC agota los
  2 min y ofrece regenerar el QR.
- **QR de emparejamiento expira** (2 min) → la PC lo regenera con nuevo `sid`.
- **Conflicto de sync (D3):** el `updatedAt` más nuevo gana todo el snapshot; se
  documenta en la UI ("la última sincronización reemplaza la anterior").
- **El sueldo nunca se toca desde la PC:** `updateDoc` de solo `shared` garantiza
  que el blob `salary` queda intacto aunque la PC sincronice muchas veces.
- **No romper el TOFU de sueldo del teléfono:** la PC no usa el device-binding de
  sueldo ni escribe en `mensajes/{docId}`.

## 10. Testing

El proyecto no tiene runner. Se extraen como **funciones puras** (testeables):
- `partirSettings` / `combinarSettings` (ida y vuelta, sin pérdida; sueldo solo en
  `salary`).
- Encode/decode del payload QR y del permiso E2E (round-trip ECDH→HKDF→AES-GCM).
- Merge por timestamp (`decidirDireccionSync(localTs, cloudTs)`).
- Compat schema v1→v2 en restore.

Se agrega **vitest** mínimo (solo devDependency + script `test`) para estas
puras — el corte de sueldo es crítico: un bug ahí filtraría el sueldo a la PC, así
que se testea explícitamente. Más **verificación end-to-end manual** PC↔teléfono
(emparejar, editar en PC, sincronizar, ver en teléfono y viceversa; confirmar que
el sueldo no aparece ni existe en la PC).

## 11. Fuera de alcance (YAGNI)

- Sync bidireccional en tiempo real / listeners (`onSnapshot`).
- Merge por registro / resolución de conflictos fina (se eligió última-sync-gana).
- Endurecer las reglas Firestore preexistentes (`delete`/overwrite abiertos).
- Múltiples PCs vinculadas simultáneamente con gestión de sesiones/revocación.
- Historial > 6 meses en la PC (se respeta el pruning actual).
