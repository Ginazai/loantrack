# ADR-005: Almacenamiento de adjuntos de pago como `bytea` en PostgreSQL

**Status:** Accepted
**Date:** 2026-09-23 (revisa la versión del 2026-09-22, que proponía un
volumen Docker local — descartada tras conocer que el destino de deploy
probable es Supabase)

## Context
LoanTrack es single-tenant, un solo deployment (ADR-001), y hoy solo
persiste en PostgreSQL — no hay ningún almacenamiento de archivos ni
credenciales de storage externo configuradas. Se necesita guardar
comprobantes (`jpg/png/webp/pdf`, máx. 10 MB) por cada `Payment`, con el
mismo control de acceso que ya protege los pagos (dueño de la cuenta o
`admin`), nunca servidos como archivo estático público.

Una primera versión de esta ADR proponía un volumen Docker montado en el
contenedor `backend`. Se descarta esa opción: el equipo planea alojar la
app en **Supabase**, cuyo backend gestionado es efímero/sin disco local
persistente propio del contenedor de aplicación — un volumen Docker no
sobrevive ahí. Además, la preferencia explícita del equipo es "mantenerse
con Postgres" en la medida de lo posible.

Verificado (búsqueda 2026-09-23, `supabase.com/docs/pricing`): Supabase
separa el tamaño de la base de datos (`Database storage`, incluido 500 MB en
el plan free / 8 GB en Pro antes de cobrar extra a US$0.125/GB) del
almacenamiento de archivos (`File storage`, otro medidor, 1 GB en free / 100
GB en Pro antes de cobrar a US$0.0213/GB — bastante más barato por GB, pero
es un servicio S3-compatible **aparte** de la base de datos, no
literalmente filas de Postgres).

## Decision
Guardar el contenido del adjunto directamente como columna `bytea` en la
tabla `payment_attachments`, dentro de la misma base de datos Postgres que
ya usa el resto de LoanTrack. No se introduce ningún servicio de
almacenamiento externo (ni volumen local, ni Supabase Storage, ni S3) en
esta entrega.

Esto es posible y razonable para la escala de este sistema: con archivos de
hasta 10 MB y el volumen "cientos de pagos, no millones" que ya asume
ADR-003, el peor caso (todos los pagos con adjunto al tamaño máximo) sigue
siendo del orden de unos pocos GB — cómodo tanto en un Postgres autoalojado
como en un proyecto Supabase de pago (8 GB incluidos en Pro).

El acceso al binario queda detrás de `payments/service.py`
(`attach_file`/`get_attachment`/`delete_attachment`), no expuesto como campo
plano en los schemas de listado — así el día que se quiera mover el
contenido a un backend distinto, el cambio queda contenido a esa capa de
servicio y no se propaga a `router.py` ni al frontend.

## Alternatives considered
- **Volumen Docker local** (propuesta original) — descartada: no es
  compatible con un deploy gestionado tipo Supabase, y de todas formas exige
  provisionar y respaldar un volumen aparte de la base de datos, justo lo
  que el equipo quiere evitar.
- **Supabase Storage (u otro S3-compatible)** — es la opción "correcta" a
  mediano plazo si el volumen de adjuntos crece: por GB es ~6x más barato
  que el almacenamiento de base de datos en el plan Pro de Supabase, no
  compite por la cuota de tamaño de la base de datos (que también aloja el
  ledger financiero), y viene con CDN. Se descarta **por ahora** porque:
  (a) agrega una dependencia/credencial nueva que hoy no existe en el
  stack, (b) el equipo priorizó explícitamente "mantenerse con Postgres", y
  (c) a la escala actual el ahorro de costo no es significativo. Queda
  como la migración natural si el volumen de adjuntos crece mucho o si el
  proyecto efectivamente se aloja en Supabase y se quiere liberar cuota de
  base de datos — swap contenido dentro de `payments/service.py`, sin tocar
  el resto del sistema, gracias a que el binario no se expone directo en la
  API.
- **PostgreSQL Large Objects (`pg_largeobject`/API `lo`)** — evita el límite
  práctico de tamaño de fila que tiene `bytea` (irrelevante aquí, con un
  tope de 10 MB muy por debajo de cualquier límite de `bytea`), pero los
  Large Objects son un mecanismo aparte de las tablas normales: no tienen
  Row-Level Security propia (no son filas de una tabla común, sino entradas
  en `pg_largeobject`) y algunas herramientas de backup/replicación
  requieren manejo especial para incluirlos. Como el tamaño máximo de 10 MB
  cabe holgadamente en `bytea` sin ese costo adicional, no hay razón para
  pagar esa complejidad.

## Consequences
### Impact on the existing system
- Nueva tabla `payment_attachments` (`content: bytea`, más metadatos:
  `original_filename`, `content_type`, `size_bytes`, `uploaded_by`,
  `created_at`), con `ON DELETE CASCADE` desde `payments`, igual que ya hace
  `payments` respecto de `loan_accounts`.
- `docker-compose.yml` **no cambia** — no hay volumen nuevo que agregar.
- La descarga se sirve por streaming desde el backend (mismo patrón que ya
  usan los endpoints de export CSV en `admin/router.py`), nunca vía nginx
  estático.

### Migration
No aplica — no hay adjuntos previos que migrar, y no se requiere aprovisionar
infraestructura nueva.

### Other consequences
- **Backups quedan resueltos "gratis":** cualquier backup de la base de
  datos (`pg_dump`, snapshots/point-in-time recovery si se usa Supabase)
  cubre automáticamente los adjuntos, porque son filas normales — responde
  directamente la pregunta abierta #5 del requerimiento sin necesitar un
  proceso de backup aparte.
- **Costo a vigilar si se despliega en Supabase:** el tamaño de los
  adjuntos cuenta contra la cuota (más cara) de tamaño de base de datos, no
  contra la cuota (más barata) de `File storage`. A la escala actual esto es
  irrelevante; si el volumen de comprobantes crece de forma importante,
  conviene revisar esta ADR y evaluar migrar a Supabase Storage.
- **Límite de tamaño de fila:** 10 MB por archivo está muy por debajo del
  límite práctico de una columna `bytea` en Postgres (limitado por
  `TOAST`, del orden de 1 GB); no representa un riesgo técnico a esta
  escala.
