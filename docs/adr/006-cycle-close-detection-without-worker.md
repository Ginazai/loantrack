# ADR-006: Detección de cierre de ciclo sin worker externo

**Status:** Accepted
**Date:** 2026-09-22 (confirmada 2026-09-23)

## Context
Hoy el interés solo se calcula "de paso" dentro de
`PaymentService.add_payment`, cuando alguien registra un pago. No existe
ningún proceso que note que una fecha de ciclo (15/30, ver
`interest_engine.get_cycle_dates`) pasó si no hubo pago ese día. Se pide un
webhook `cycle.closed` que se dispare igual, sin depender de que haya pago,
y explícitamente **sin** un worker/cola nueva. El repo ya resuelve un
problema análogo — reintentos de entrega de webhooks — con una tarea
`asyncio` (`_webhook_retry_loop`) lanzada en el `lifespan` de FastAPI
(`main.py`), sin Celery/RQ ni contenedor de worker.

## Decision
Agregar una segunda tarea `asyncio`, `_cycle_close_scan_loop()`, hermana de
`_webhook_retry_loop()` en el mismo `lifespan`. Corre cada
`CYCLE_SCAN_INTERVAL_SECONDS` (propuesto 3600s): para cada cuenta
`open`/`active`, calcula `get_cycle_dates(start_date, until=hoy)` y compara
contra una tabla nueva `account_cycle_notifications`
(`UNIQUE(account_id, cycle_date)`). Las fechas que no estén ya registradas
generan una fila de notificación + un `WebhookEvent(event="cycle.closed")`
por cada `WebhookConfig` suscrito — reutilizando tal cual el pipeline de
entrega/reintento existente (`WebhookDeliveryService`), sin canal paralelo.
**Confirmado:** el escaneo cubre únicamente cuentas `open`/`active`; una
cuenta que pasa a `paid`/`closed` deja de generar `cycle.closed` a partir
de ese momento, aunque queden fechas de ciclo "calendario" posteriores.

## Alternatives considered
- **Worker/cola dedicada (Celery + Redis, RQ, cron container aparte)** —
  es el patrón "de libro" para tareas programadas, pero agrega infraestructura
  (broker, otro servicio en `docker-compose.yml`, otro proceso a operar) para
  un chequeo que en este dominio corre a lo sumo un par de veces al día por
  cuenta. Descartado por sobre-ingeniería frente al patrón ya validado en el
  propio repo.
- **Un solo campo `LoanAccount.last_cycle_notified: date`** en vez de tabla
  de notificaciones — más simple, pero pierde historial y no maneja bien una
  cuenta "dormida" (sin escaneo por un tiempo) que acumuló varios ciclos
  vencidos de una sola vez: con un solo campo solo se podría saber "el
  último", no encolar un evento por cada fecha vencida. La tabla con
  `UNIQUE(account_id, cycle_date)` sí soporta ese caso de backlog de forma
  natural (se insertan todas las fechas nuevas en la misma corrida).
- **Calcularlo dentro de `_webhook_retry_loop()` existente** — se descarta
  mezclar dos responsabilidades distintas (reintentar entregas ya encoladas
  vs. detectar nuevos eventos de negocio) en una sola tarea con un solo
  intervalo; conviene que cada una tenga su propio intervalo de configuración
  (reintento de webhook es más frecuente/urgente que detectar un cierre de
  ciclo).

## Consequences
### Impact on the existing system
- Nueva tabla `account_cycle_notifications`, cascada desde `loan_accounts`.
- `"cycle.closed"` se agrega a `WEBHOOK_EVENTS`/`allowed` en
  `webhooks/schemas.py` — cambio aditivo, no rompe configuraciones de
  webhook existentes (que simplemente no listan ese evento hasta que un
  admin lo agregue).
- Una nueva variable de configuración `CYCLE_SCAN_INTERVAL_SECONDS` en
  `core/config.py` y `docker-compose.yml`, siguiendo el mismo patrón que
  `WEBHOOK_RETRY_DELAY_SECONDS`.

### Migration
No aplica — tabla nueva, sin datos previos. Al desplegar, la primera corrida
del scan encontrará (potencialmente) varios ciclos ya vencidos por cuenta
existente y los notificará todos de una vez; si eso no es deseable para
cuentas viejas, se puede pre-poblar `account_cycle_notifications` con los
ciclos pasados a la fecha del despliegue en el mismo commit/migración que
crea la tabla (a decidir junto con el equipo antes de desplegar a producción).

### Other consequences
- El costo por corrida es una consulta de cuentas activas + un loop en
  Python puro (`get_cycle_dates` ya es una función pura, sin I/O) — barato
  incluso con cientos de cuentas, consistente con la escala descrita en
  ADR-003 ("cientos de pagos, no millones").
- Si el proceso backend se reinicia entre corridas, no se pierde ni duplica
  nada: la próxima corrida vuelve a calcular `get_cycle_dates` completo y la
  tabla de notificaciones ya escritas actúa como filtro idempotente.
