# Requerimientos: Importación de datos, adjuntos de pago y webhooks de cierre de ciclo

Status: Accepted (preguntas abiertas resueltas 2026-09-23)
Date: 2026-09-22
Autor: Claude (planificación asistida, a validar por el equipo)

## 1. Contexto (de lo descubierto en el repo)

LoanTrack es una herramienta interna single-tenant (ver ADR-001). Puntos que
restringen lo que sigue:

- El balance nunca se guarda como campo mutable de confianza: `Payment` es
  inmutable y `project_ledger()` en `modules/accounts/interest_engine.py` es
  la única fuente de verdad para reconstruir saldos (ADR-003). Cualquier
  importación de pagos históricos debe respetar esto: no se "parchea" un
  balance, se insertan filas de `Payment` coherentes con el historial.
- Los ciclos de interés son el 15 y el 30 (o último día del mes) de cada mes,
  calculados por `next_cycle_date` / `advance_cycle` / `get_cycle_dates` en
  `interest_engine.py`. Hoy el interés solo se calcula "de paso" cuando se
  registra un pago (`PaymentService.add_payment`); no existe un proceso que
  marque el cierre de un ciclo si no hay pago ese día.
- Ya existe un mecanismo de entrega de webhooks (`WebhookConfig`,
  `WebhookEvent`, `WebhookDeliveryService`) y un *loop* en `main.py`
  (`_webhook_retry_loop`, tarea `asyncio` lanzada en el `lifespan` de
  FastAPI) que reintenta eventos pendientes sin usar un worker externo.
  Este es el patrón a reutilizar/extender, no reemplazar.
- No existe hoy ningún mecanismo de subida/almacenamiento de archivos en el
  backend (`grep` sobre `UploadFile`/`storage`/`s3` no arroja nada más que el
  propio import del módulo `main`). Tampoco hay volumen Docker para archivos,
  solo `postgres_data` y `pgadmin_data`.
- Ya existe exportación CSV en `modules/admin/router.py`
  (`/admin/export/accounts.csv`, `/admin/export/payments.csv`,
  `/admin/export/accounts/{id}/full.csv`), pero **no existe importación**.
- El archivo de referencia entregado por el usuario
  (`borrowing_data_as_of_20-09-2026.csv`) **no** tiene el formato de
  exportación nativa. Es un libro contable plano con columnas
  `Referencia, Fecha, Descripcion, Debito, Credito`, donde:
  - `Referencia` es un número corto (1, 2, 3…) que identifica un préstamo
    dentro de esa hoja, sin relación con los UUID internos de LoanTrack.
  - Cada préstamo tiene exactamente una fila `"Prestamo de $X otorgado"`
    (un solo desembolso; se verificó sobre las 28 referencias con
    desembolso que ninguna tiene más de una).
  - Las filas `"Intereses acomulados en la cuenta"` (Débito) **siempre**
    coinciden en fecha+referencia con una fila `"pago por $X realizado"`
    (Crédito) — se verificó: 0 de 241 grupos fecha+referencia tienen interés
    sin pago el mismo día. Sí hay 14 grupos con pago sin interés el mismo
    día (pago fuera de ciclo, ya contemplado por el motor actual).
  - Fechas en formato `DD/MM/YYYY`.

Esto importa porque define el diseño del parser: cada grupo
(`Referencia`, `Fecha`) del archivo legado mapea 1:1 a un futuro
`Payment` (con `interests_accrued` tomado del Débito de esa fecha si
existe, y `amount` tomado del Crédito), nunca a un ajuste "solo interés".

## 2. Objetivo

Agregar tres capacidades nuevas a LoanTrack, cada una independiente entre sí
pero compartiendo la infraestructura existente (auth, auditoría, webhooks):

1. **Importación de datos** — csv primero, extensible a JSON — soportando
   tanto el formato de exportación propia (round-trip) como el formato de
   libro contable externo tipo el archivo de referencia.
2. **Adjuntos por pago** — permitir subir un comprobante (imagen o PDF) a
   cada `Payment`.
3. **Webhooks de cierre de ciclo** — nuevo evento que se dispare cuando un
   ciclo (15/30) de una cuenta se cierra, exista o no un pago ese día, sin
   introducir un worker/cola externa.

## 3. Requerimientos funcionales

### 3.1 Importación de datos

- R1.1 Solo `admin` puede importar (coherente con que hoy solo `admin` tiene
  export CSV — ver tabla de roles en el README).
- R1.2 Flujo en dos fases obligatorio: **preview** (parsear y validar sin
  persistir nada) → **commit** (persistir solo lo que el admin confirmó).
  No debe existir un endpoint que importe "directo a ciegas": los datos
  financieros son sensibles a errores de mapeo.
- R1.3 El sistema debe detectar/aceptar dos formatos de CSV en la v1:
  - **Nativo**: el mismo esquema que produce `/admin/export/*.csv`
    (`accounts.csv`, `payments.csv`, o el combinado `full.csv` por cuenta).
    Éste es el camino de *restore*/migración entre instancias.
  - **Libro contable legado**: columnas
    `Referencia, Fecha, Descripcion, Debito, Credito`, con las 3 categorías
    de fila descritas en la sección 1 (desembolso / interés acumulado /
    pago). El parser debe reconocer las frases en español
    ("otorgado", "Intereses acomulad_", "pago por $... realizado") vía
    patrones tolerantes (mayúsculas/tildes/errores de tipeo como
    "acomulados") en lugar de *match* exacto.
- R1.4 Para el formato legado, cada `Referencia` debe mapearse explícitamente
  por el admin, en el paso de preview, a: (a) una cuenta (`LoanAccount`)
  existente, o (b) "crear cuenta nueva" (usando el monto y fecha de la fila
  de desembolso). El sistema no debe adivinar esta relación automáticamente
  más allá de proponerla como sugerencia.
- R1.5 El preview debe mostrar, por cada `Referencia`/fila: la interpretación
  (tipo de movimiento, monto, fecha), y advertencias (fecha inválida, monto
  no numérico, referencia sin desembolso, moneda con formato inesperado).
  Las filas con error se listan pero no bloquean el commit de las filas
  válidas (commit parcial explícito, visible en el resultado).
- R1.6 Los pagos creados por importación deben quedar marcados como tales
  (nuevo valor de `Payment.method`, ver sección 4) para poder auditarlos y
  para que la UI los distinga de pagos capturados en vivo. **Estos pagos
  nunca disparan `payment.added`** (confirmado — ver sección 6, punto 2).
- R1.7 Debe quedar un registro auditable de cada importación (archivo,
  usuario, fecha, filas totales/insertadas/con error) — reutilizando
  `AuditService` más una entidad propia `ImportBatch` para el detalle fila a
  fila (ver sección 5).
- R1.8 El diseño del parser debe ser extensible a JSON sin reescribir el
  flujo de preview/commit (ver ADR-004). No se implementa el parser JSON en
  esta primera entrega — solo se deja el punto de extensión.

### 3.2 Adjuntos de pago

- R2.1 Al registrar un pago (`POST /accounts/{id}/payments`) o después,
  se debe poder adjuntar uno o más archivos (comprobante de transferencia,
  foto de recibo, etc.).
- R2.2 Tipos permitidos: imágenes (`jpg`, `png`, `webp`) y `pdf`. Tamaño
  máximo por archivo: **10 MB** (confirmado).
- R2.3 Los adjuntos son visibles para el dueño de la cuenta y para `admin`;
  la descarga debe pasar por el mismo control de acceso que ya usa
  `PaymentService`/`LoanAccountService` (dueño u `admin`), nunca servidos
  como archivo estático público.
- R2.4 Borrar un adjunto: solo `admin` (mismo criterio que
  `DELETE /accounts/{id}/payments/{payment_id}`, que ya es admin-only).
- R2.5 Borrar un `Payment` borra en cascada sus adjuntos (archivo + fila),
  igual que hoy `LoanAccount` borra en cascada sus `Payment`.
- R2.6 Los pagos importados (sección 3.1) también deben poder llevar
  adjunto, por si el admin sube el comprobante escaneado en un paso
  posterior al import.

### 3.3 Webhooks de cierre de ciclo

- R3.1 Nuevo tipo de evento `cycle.closed`, agregado a la lista existente en
  `WEBHOOK_EVENTS` (`webhooks/schemas.py`) y al set `allowed` del validador.
  Reutiliza la configuración de webhook existente (`WebhookConfig`, global o
  por cuenta) y la tabla `WebhookEvent` / `WebhookDeliveryService` para el
  envío y reintentos — no se crea un canal de entrega paralelo.
- R3.2 El evento se dispara cuando una fecha de ciclo (15 o 30, según
  `get_cycle_dates`) de una cuenta `open`/`active` llega a ser `<= hoy`,
  **haya o no un pago registrado ese día**. Si ya hubo un pago ese día, el
  evento igual se emite (es información distinta: "el ciclo cerró", no
  "hubo un pago" — ese ya existe como `payment.added`). Solo se escanean
  cuentas `open`/`active` (confirmado); una cuenta que se cierra manualmente
  a mitad de ciclo deja de generar `cycle.closed` desde ese momento.
- R3.3 El disparo debe ser idempotente: un mismo (`account_id`, `cycle_date`)
  nunca genera dos eventos `cycle.closed`, sin importar cuántas veces corra
  el proceso de verificación o cuántos reinicios del backend ocurran entre
  medio.
- R3.4 No se introduce un worker/cola externa (Celery, RQ, cron container).
  Se extiende el patrón ya existente en `main.py` (`_webhook_retry_loop`
  como tarea `asyncio` del `lifespan`) con una segunda tarea de bajo costo
  que revisa periódicamente qué ciclos cerraron.
- R3.5 El payload debe incluir al menos: `account_id`, `cycle_date`,
  `opening_balance`, `interests_accrued`, `closing_balance` proyectado con
  `project_ledger` hasta esa fecha — mismos campos/formato que ya usa
  `payment.added` en `PaymentService.add_payment`, para consistencia del
  contrato hacia afuera.

## 4. No-objetivos (fuera de alcance de esta entrega)

- Importación recurrente/programada o conectores en vivo a otro sistema
  contable — esta entrega es importación manual bajo demanda.
- Edición de filas ya importadas dentro del flujo de import (se editan como
  cualquier `Payment`/`LoanAccount` normal después, con las mismas reglas de
  hoy).
- OCR o extracción automática de datos desde el comprobante adjunto — el
  adjunto es solo almacenamiento + descarga.
- Múltiples adjuntos por pago con reordenamiento/galería avanzada — se
  soporta una lista simple (0..N archivos por pago).
- Notificación en tiempo real (websocket/push) del cierre de ciclo al
  frontend — el requerimiento es el webhook saliente, no una UI reactiva
  nueva (aunque nada impide agregarla luego reusando el mismo evento).
- Firma/verificación antivirus de archivos subidos (ver riesgos).
- Reescalado horizontal multi-réplica del backend con estado compartido de
  archivos — se documenta como limitación conocida del ADR-005, no se
  resuelve aquí.

## 5. Modelo de datos (nuevas entidades)

| Entidad | Propósito | Relación |
|---|---|---|
| `ImportBatch` | Cabecera de una importación: archivo, formato, quién, cuándo, estado (`previewed`/`committed`/`failed`), resumen agregado. | 1 → N `ImportRow` |
| `ImportRow` | Detalle fila a fila del preview/commit: fila original, interpretación, resultado (`ok`/`error`/`skipped`), entidad creada (`account_id`/`payment_id` si aplica). | N → 1 `ImportBatch` |
| `PaymentAttachment` | Un archivo adjunto a un pago. El binario se guarda en una columna `bytea` (ver ADR-005 revisada), no en disco. | N → 1 `Payment` (cascade delete) |
| `AccountCycleNotification` | Registro de qué (`account_id`, `cycle_date`) ya disparó `cycle.closed`, para idempotencia. | N → 1 `LoanAccount` (cascade delete), `UNIQUE(account_id, cycle_date)` |

Cambios a entidades existentes:

- `Payment.method`: pasa de `Literal["auto", "manual"]` a
  `Literal["auto", "manual", "import"]` (schema) — la columna ya es
  `String(10)`, cabe sin migrar tipo, pero sí conviene documentar el nuevo
  valor.
- `WEBHOOK_EVENTS` / `allowed` en `webhooks/schemas.py`: agregar
  `"cycle.closed"`.

## 6. Preguntas abiertas — RESUELTAS (2026-09-23)

1. **Tamaño/tipos de archivo permitidos para adjuntos** — **Confirmado:**
   10 MB máximo, `jpg/png/webp/pdf`.
2. **¿Los pagos creados por import deben disparar `payment.added`?** —
   **Confirmado: no, nunca.** Se elimina el checkbox opcional "notificar
   webhooks" propuesto originalmente en el commit del import — el import
   **nunca** encola `payment.added` ni `cycle.closed`. Simplifica R1.6/R3.x:
   el servicio de import ni siquiera necesita tocar `WebhookEvent`.
3. **Alcance del escaneo de cierre de ciclo** — **Confirmado:** solo cuentas
   `open`/`active`. Una cuenta cerrada manualmente a mitad de ciclo **no**
   dispara `cycle.closed` para ciclos posteriores a su cierre.
4. **Formato JSON de importación** — **Confirmado: se omite de esta
   entrega.** El punto de extensión (`ImportParser`, ADR-004) queda
   definido en el diseño, pero no se implementa `json_ledger.py` ni se
   diseña su esquema hasta que exista un caso de uso concreto.
5. **Almacenamiento/backups de adjuntos — decisión: bytea en PostgreSQL**,
   no volumen de disco. Ver ADR-005 (revisada) para el detalle completo y
   el trade-off frente a Supabase Storage. Resumen: los adjuntos se guardan
   como columna `bytea` en la tabla `payment_attachments`, por lo que
   quedan cubiertos automáticamente por cualquier backup de la base de
   datos existente (`pg_dump`, point-in-time recovery de Supabase, etc.) —
   no se necesita un proceso de backup aparte ni un volumen Docker nuevo.
