## Why

Gen12 Software tiene ~8.600 empresas segmentadas en "Base segmentada Gen12.xlsx" y hoy las contacta con un script Python local (`enviar_whatsapp.py`) que manda plantillas por la WhatsApp Cloud API y anota los envíos en un CSV y en el propio Excel. Ese esquema no sabe si el mensaje se entregó o se leyó, no registra las respuestas, depende de cargar las bajas a mano en `bajas.txt` y no puede mandar seguimientos. Necesitamos una app web interna que centralice la base, despache campañas respetando los límites de Meta, siga el estado de cada mensaje y automatice los seguimientos sin poner en riesgo la calidad del número.

## What Changes

- Nueva app web interna (Next.js App Router en Vercel + Supabase) con login por Supabase Auth.
- Importación del Excel (hoja "Contactos") a Postgres con upsert por número de WhatsApp, deduplicación, respeto de `Enviar=NO` y reimportación sin pisar el historial de envíos. También toma como historial los envíos ya hechos por el script (columna "Estado envío") y las bajas de `bajas.txt`.
- Creación de campañas filtrando por rubro y zona (multiselección), con conteo de destinatarios y vista previa del mensaje final por contacto.
- Cola de envíos en base de datos, despachada en lotes por un job programado, con tope diario configurable (default 200), sin repetir nunca la misma plantilla de campaña al mismo número y excluyendo siempre las bajas.
- Pausa automática de la campaña ante errores de cuenta, de límite o de plantilla de Meta, con aviso en el panel.
- Endpoint de webhook (verificación GET y POST con firma `X-Hub-Signature-256`) que registra estados (sent / delivered / read / failed) sin retroceder, el objeto `pricing` y las respuestas entrantes (texto y botones), con baja automática ante "No, gracias" o "BAJA".
- Reglas de seguimiento por campaña ("leído sin respuesta a los N días", "entregado sin leer a los N días") evaluadas por un job diario de `pg_cron` + `pg_net` que llama a una ruta protegida con secreto.
- Panel por campaña con métricas (enviados, entregados, leídos, fallidos, respondieron, "Me interesa", bajas, costo estimado) y tabla por contacto filtrable y exportable a CSV.
- Nueva plantilla de seguimiento `gen12_seguimiento_1` a cargar en Meta.

### Fuera de alcance (para un change futuro)

- Bandeja de conversaciones para responder desde la app dentro de la ventana de 24 h.
- Clasificación automática de rubro para contactos nuevos.
- Multiusuario con roles: en v1 todo usuario autenticado de Supabase Auth tiene acceso total.
- Envío de mensajes de texto libre (fuera de plantillas).

## Capabilities

### New Capabilities

- `contact-import`: importar el Excel segmentado a la base, con upsert por WhatsApp, deduplicación, respeto de exclusiones e importación del historial previo sin pisar envíos.
- `campaign-sending`: crear campañas por rubro y zona con vista previa, encolar y despachar envíos en lotes con tope diario, idempotencia, exclusión de bajas y pausa ante errores de Meta.
- `message-tracking`: webhook de WhatsApp con verificación y firma, registro de estados monotónicos, costo (`pricing`), respuestas entrantes y bajas.
- `follow-up-automation`: reglas de seguimiento por campaña evaluadas por un job diario, con tope de seguimientos por contacto y corte de la secuencia.
- `campaign-dashboard`: métricas por campaña y tabla por contacto filtrable y exportable a CSV.

### Modified Capabilities

<!-- Ninguna: no hay specs existentes en openspec/specs/. -->

## Impact

- **Código nuevo**: proyecto Next.js (rutas de UI, route handlers `/api/webhooks/whatsapp`, `/api/cron/dispatch`, `/api/cron/follow-ups`, exportación CSV) y migraciones SQL de Supabase (tablas, RLS, funciones, jobs de `pg_cron`).
- **Dependencias**: `@supabase/supabase-js`, `@supabase/ssr`, una librería para leer `.xlsx` (SheetJS) y las extensiones de Postgres `pg_cron` y `pg_net`.
- **Sistemas externos**: WhatsApp Cloud API (Graph API, versión por `WA_API_VERSION`), configuración del webhook en la app de Meta y alta de la plantilla de seguimiento en WhatsApp Manager.
- **Variables de entorno**: `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_API_VERSION`, `CRON_SECRET`, más las de Supabase.
- **Operación**: el script `enviar_whatsapp.py` deja de usarse para enviar una vez migrado el historial; la columna "Estado envío", `bajas.txt` y, si existe, `envios_log.csv` se importan para no repetir envíos ni contactar bajas.
