# Plan de implementación: Importación, adjuntos y webhooks de cierre de ciclo

Status: Accepted
Date: 2026-09-22 (actualizado 2026-09-23 tras resolver preguntas abiertas)
Depende de: `001-import-attachments-cycle-webhooks.md`

## 1. Dónde vive cada cosa (respetando la estructura de módulos actual)

```
backend/app/modules/
├── imports/              # NUEVO módulo
│   ├── models.py          # ImportBatch, ImportRow
│   ├── schemas.py
│   ├── parsers/
│   │   ├── base.py         # interfaz ImportParser (sniff/parse)
│   │   ├── native_csv.py   # formato accounts.csv/payments.csv/full.csv
│   │   └── legacy_ledger_csv.py  # formato Referencia/Fecha/Descripcion/...
│   ├── service.py          # preview() / commit()
│   ├── router.py           # /admin/imports/*
│   └── tests/
├── payments/
│   ├── models.py           # + PaymentAttachment (content: bytea, ver ADR-005)
│   ├── schemas.py          # + PaymentAttachmentOut, method: +"import"
│   ├── service.py          # + attach_file / list_attachments / delete_attachment
│   └── router.py           # + endpoints de adjuntos anidados
├── accounts/
│   └── models.py           # + AccountCycleNotification (o módulo webhooks, ver abajo)
└── webhooks/
    ├── models.py           # + AccountCycleNotification
    ├── schemas.py          # + "cycle.closed" en WEBHOOK_EVENTS/allowed
    └── service.py          # + CycleCloseScanService
```

`AccountCycleNotification` se coloca en `modules/webhooks/models.py` en vez de
`accounts`: es puramente infraestructura de notificación (no cambia el
significado de negocio de la cuenta), igual que `WebhookEvent` ya vive ahí y
no en `accounts`.

`imports/parsers/legacy_ledger_csv.py` es el único parser que conoce las
frases en español del archivo de referencia — el resto del sistema no debe
acoplarse a ese vocabulario.

## 2. Qué NO cambia

- `interest_engine.py` no se toca. Tanto el import (legado) como el escaneo
  de cierre de ciclo **reutilizan** `get_cycle_dates`, `next_cycle_date`,
  `project_ledger` tal como están — son funciones puras, ya cubiertas por
  ADR-003. El import legado usa los montos de interés **tal cual vienen en
  el CSV** (no los recalcula), porque son historial ya cerrado; el escaneo de
  cierre de ciclo sí usa `project_ledger` para proyectar (cuentas vivas).
- `PaymentService.add_payment` no cambia su contrato para el flujo normal
  (UI en vivo). El import no pasa por `add_payment`: inserta `Payment`
  directamente con los valores del historial, porque `add_payment` asume
  "hoy" y recalcula contra el estado actual, lo cual no aplica a una carga
  histórica con fechas pasadas y (potencialmente) tasas ya vencidas.
- `WebhookDeliveryService` no cambia. Tanto `payment.added` (ya existente)
  como el nuevo `cycle.closed` insertan filas en `WebhookEvent` con
  `status="pending"`; la entrega/reintento es el mismo código de siempre.
- El esquema de auth/roles no cambia: todo lo nuevo respeta
  admin-only donde ya existía ese criterio (export CSV, borrar pagos).
- `docker-compose.yml` **no cambia en absoluto** — con adjuntos como `bytea`
  en Postgres no se necesita volumen ni servicio nuevo (ver ADR-005
  revisada). Esto es justamente lo que permite que el mismo `docker-compose`
  siga funcionando igual si el equipo migra a Postgres gestionado por
  Supabase más adelante: no hay disco local del que depender.

## 3. Secuencia de implementación (fases, cada una entregable por separado)

### Fase 1 — Adjuntos de pago (la más aislada, buena para ir primero)
1. Migración Alembic: tabla `payment_attachments`, con `content: bytea`
   (ver ADR-005 revisada — se descarta el volumen de disco).
2. Validación de tipo (`jpg/png/webp/pdf`) y tamaño (10 MB máx.) en el
   endpoint antes de insertar el `bytea`, para no depender de un límite de
   nginx/proxy que hoy no está configurado para esto.
3. Endpoints en `payments/router.py`:
   `POST/GET /accounts/{account_id}/payments/{payment_id}/attachments`,
   `GET/DELETE .../attachments/{attachment_id}` (descarga = `StreamingResponse`
   leyendo la columna `bytea`, mismo patrón que ya usan los export CSV en
   `admin/router.py`).
4. Frontend: input de archivo opcional en `PaymentForm.tsx`; ícono/contador
   de adjuntos + acción de descarga en la fila de pago dentro de
   `AccountDetailPage.tsx`.
5. Tests: subida válida; tipo no permitido; tamaño excedido; descarga
   respeta ownership; cascade delete al borrar el pago.

### Fase 2 — Webhook de cierre de ciclo (reutiliza infraestructura existente)
1. Migración Alembic: tabla `account_cycle_notifications` con
   `UNIQUE(account_id, cycle_date)`.
2. Agregar `"cycle.closed"` a `WEBHOOK_EVENTS`/`allowed` en
   `webhooks/schemas.py`.
3. `CycleCloseScanService.scan()`: para cada cuenta `open`/`active`,
   `get_cycle_dates(account.start_date, until=today)`, filtrar las que no
   estén ya en `account_cycle_notifications`, insertar la fila de
   notificación + un `WebhookEvent` por cada `WebhookConfig` activo suscrito
   a `cycle.closed` (mismo patrón que ya usa `PaymentService.add_payment`
   para `payment.added`).
4. En `main.py`: nueva tarea `_cycle_close_scan_loop()` en el `lifespan`,
   hermana de `_webhook_retry_loop()`, con su propio intervalo
   (`CYCLE_SCAN_INTERVAL_SECONDS`, default propuesto 3600s — corre una
   consulta barata, no hay urgencia de segundos).
5. Tests: idempotencia (correr `scan()` dos veces no duplica), cuenta recién
   creada sin ciclos vencidos no dispara nada, cuenta con varios ciclos
   vencidos de una sola vez (backlog) dispara uno por cada fecha.

### Fase 3 — Importación (la más grande, depende conceptualmente de nada de
lo anterior, pero se beneficia de que `Payment.method` ya soporte `"import"`)
1. Ampliar `Payment.method` a `Literal["auto", "manual", "import"]` en
   `payments/schemas.py` (sin migración: la columna ya es `String(10)`).
2. Migraciones Alembic: tablas `import_batches`, `import_rows`.
3. `imports/parsers/base.py`: interfaz `sniff(raw: bytes) -> bool` +
   `parse(raw: bytes) -> ParsedLedger` (dataclass con listas de
   cuentas-a-crear y pagos-a-crear, más lista de errores por fila).
4. `imports/parsers/native_csv.py`: reconoce el header de
   `accounts.csv`/`payments.csv`/el `full.csv` combinado.
5. `imports/parsers/legacy_ledger_csv.py`: agrupa por
   (`Referencia`, `Fecha`), clasifica cada grupo (desembolso / interés+pago /
   pago solo) con regex tolerante sobre `Descripcion`, arma un `ParsedLedger`
   por referencia.
6. `imports/service.py`:
   - `preview(file, format_hint)`: corre `sniff`+`parse`, devuelve el
     `ParsedLedger` + una propuesta de mapeo `Referencia → cuenta existente
     (por nombre similar) | crear nueva`, sin tocar la base de datos salvo
     por la fila `ImportBatch(status="previewed")` + sus `ImportRow`.
   - `commit(batch_id, mapping_overrides)`: crea/actualiza cuentas y pagos
     según el mapeo confirmado por el admin, usando `AuditService` por cada
     entidad creada. **Nunca** dispara `payment.added` ni `cycle.closed`
     (confirmado — sección 6 del requerimiento): el import no toca
     `WebhookEvent` en absoluto.
7. `imports/router.py`: `POST /admin/imports/preview`,
   `GET /admin/imports/{id}`, `POST /admin/imports/{id}/commit`,
   `GET /admin/imports` (historial).
8. Frontend: pantalla nueva bajo `features/admin/` (ej. `ImportsPage.tsx`)
   con: subir archivo → tabla de preview con mapeo editable → confirmar
   commit → resumen con filas ok/erróneas.
9. Tests: parser nativo round-trip (exportar → importar → mismo estado);
   parser legado contra una muestra representativa del archivo de
   referencia (incluyendo los 14 casos de "pago sin interés el mismo día");
   fila inválida no bloquea el resto; commit parcial queda auditado.

## 4. Compatibilidad / migración

- Todas las tablas nuevas son aditivas (no se modifica ninguna columna
  existente salvo el rango de valores permitidos de `Payment.method`, que es
  un cambio no destructivo).
- Los adjuntos viven en la misma base de datos (columna `bytea`); no hay
  volumen ni infraestructura nueva que provisionar, ni datos previos que
  migrar.
- No hay *feature flag* necesario: cada capacidad es un endpoint nuevo que no
  cambia el comportamiento de los endpoints existentes si no se usa.

## 5. Cobertura de tests existente (riesgo)

`payments/tests/`, `webhooks/tests/` y `accounts/tests/` ya existen — hay que
extenderlos, no crearlos desde cero. `imports/` es módulo nuevo, arranca sin
cobertura: la Fase 3 debe incluir tests desde el primer commit para no bajar
el umbral `--cov-fail-under=60` del pipeline (ver README).
