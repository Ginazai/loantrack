# ADR-004: Estrategia de importación de datos (parsers desacoplados + preview/commit)

**Status:** Accepted
**Date:** 2026-09-22 (confirmada 2026-09-23)

## Context
Se necesita importar dos formatos de CSV distintos — el propio formato de
exportación de LoanTrack (round-trip) y un formato de libro contable externo
en español (`Referencia, Fecha, Descripcion, Debito, Credito`), con planes de
soportar JSON más adelante. `Payment` es inmutable y `project_ledger()` es la
única fuente de verdad de saldos (ADR-003), así que insertar datos históricos
mal interpretados corrompe el ledger de forma difícil de revertir sin borrar
pagos a mano.

## Decision
1. Un módulo nuevo `modules/imports/` con una interfaz `ImportParser`
   (`sniff(bytes) -> bool`, `parse(bytes) -> ParsedLedger`) y un parser por
   formato (`native_csv.py`, `legacy_ledger_csv.py`, y en el futuro un
   `json_ledger.py`). El servicio de importación no conoce el formato
   concreto, solo itera los parsers registrados hasta que uno acepta el
   archivo (`sniff`).
2. El flujo es siempre **preview → commit** en dos pasos separados. El
   preview persiste únicamente `ImportBatch`/`ImportRow` (auditoría e
   interpretación), nunca `LoanAccount`/`Payment`. El commit requiere que un
   admin confirme el mapeo `Referencia → cuenta` fila por fila.
3. El parser legado interpreta los montos de interés tal como vienen en el
   CSV (no los recalcula con `project_ledger`) porque son historial ya
   cerrado y pueden reflejar una tasa distinta a la vigente hoy.
4. **Confirmado:** los pagos creados por import nunca disparan
   `payment.added` (ni ningún otro webhook). El commit del import no toca
   `WebhookEvent`. Se descarta el checkbox "notificar webhooks" que una
   versión anterior de esta ADR/requerimiento contemplaba como opcional.
5. **Confirmado:** el soporte a JSON se limita, en esta entrega, al punto de
   extensión (`ImportParser`); no se implementa un `json_ledger.py` ni se
   define su esquema hasta que exista un caso de uso concreto.

## Alternatives considered
- **Importar directo sin preview** — más simple, pero un mapeo
  `Referencia → cuenta` incorrecto insertaría pagos en la cuenta equivocada
  sin forma sencilla de revertir (no hay "deshacer import"). Se descarta por
  el costo de un error en datos financieros.
- **Un único parser genérico "detecta columnas"** — funcionaría para CSVs
  tabulares simples, pero el formato legado no es tabular en el sentido
  usual: requiere agrupar filas por (`Referencia`, `Fecha`) y clasificar por
  texto libre en `Descripcion`. Forzarlo a un parser genérico habría
  complicado ese parser con casos especiales del formato legado,
  contaminando el camino nativo.
- **Recalcular el interés histórico con `project_ledger` en vez de tomarlo
  del CSV** — descartado porque el motor asume la tasa *actual* de la
  cuenta; una carga histórica con tasas ya vencidas daría números distintos
  a los que realmente ocurrieron.

## Consequences
### Impact on the existing system
- `Payment.method` gana un tercer valor (`"import"`), cambio no destructivo
  sobre la columna `String(10)` ya existente.
- No se toca `interest_engine.py`, `PaymentService.add_payment` ni
  `WebhookDeliveryService`.

### Migration
No aplica — es una capacidad nueva sin datos previos a migrar dentro del
propio LoanTrack. La migración *hacia* LoanTrack (el caso de uso real) es
justamente lo que esta ADR habilita.

### Other consequences
- Agregar un formato nuevo (JSON u otro CSV) es agregar un archivo bajo
  `imports/parsers/` que implemente `sniff`/`parse`; no se toca
  `service.py` ni `router.py`.
- El costo es un módulo con más piezas (interfaz + 2 parsers + service +
  router) que un import "directo"; se acepta ese costo a cambio de que un
  error de interpretación se vea en el preview antes de tocar la base de
  datos real.
