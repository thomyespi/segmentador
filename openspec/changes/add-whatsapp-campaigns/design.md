## Context

- La base vive en "Base segmentada Gen12.xlsx": hoja "Contactos" (8.636 filas al día de hoy, 5.829 "Sin rubro identificado" que usan `gen12_general`), hoja "Resumen" y hoja "Plantillas" con los 11 textos cargados en Meta (nombre, rubro, categoría MARKETING, idioma es_AR, cuerpo con `{{1}}` nombre y `{{2}}` empresa, pie "gen12software.com · Respondé BAJA si no querés recibir más mensajes" y botones "Me interesa" / "No, gracias").
- Hoy se envía con `enviar_whatsapp.py`: filtra por rubro/zona, manda hasta 200 por corrida, escribe `envios_log.csv`, marca "Estado envío" en el Excel y lee bajas de `bajas.txt`. Corta ante 401/403, 131048, 131056, 130429.
- El número de WhatsApp es nuevo: Meta lo arranca con 250 destinatarios únicos cada 24 h y sube el límite según volumen y calidad. Una mala calidad (bloqueos, reportes) baja el límite o pausa plantillas.
- Stack fijado: Next.js (App Router) en Vercel, Supabase (Postgres + Auth + RLS), WhatsApp Cloud API con versión de Graph por `WA_API_VERSION`.
- Usuarios: pocas personas del equipo comercial de Gen12, todas con acceso total.

## Goals / Non-Goals

**Goals:**
- Una sola fuente de verdad (Postgres) para contactos, envíos, estados, respuestas y bajas.
- Envío confiable: nunca duplicar una plantilla de campaña a un número, nunca contactar una baja, nunca superar el tope diario.
- Seguimiento de estado tolerante a webhooks duplicados y desordenados.
- Seguimientos automáticos conservadores, que protejan la calidad del número.
- Operar sin servidores propios ni crons de Vercel: el reloj lo pone `pg_cron`.

**Non-Goals:**
- Bandeja de conversaciones / respuestas manuales dentro de la ventana de 24 h.
- Clasificación automática de rubro de contactos nuevos.
- Roles y permisos por usuario.
- Mensajes de texto libre, multimedia o plantillas con encabezado de imagen.
- Sincronización automática del catálogo de plantillas por la Graph API (ver Open Questions).

## Decisions

### 1. Modelo de datos

Todas las tablas en el esquema `public`, con `id uuid` (o `bigint` donde el volumen lo justifica), `created_at` y `updated_at`.

| Tabla | Propósito | Columnas clave |
|---|---|---|
| `contacts` | Un contacto por número | `wa_phone text unique` (549XXXXXXXXXX), `excel_id`, `contact_name`, `company`, `rubro`, `rubro_source`, `zona`, `zona_source`, `var_1`, `var_2`, `template_name` (columna Plantilla), `send_allowed bool`, `exclusion_reason`, `original jsonb` (Nombre/Localidad/Rubro/Segmento original, CUIT/DNI, Tiene página?, Asesor), `opted_out_at`, `last_import_id` |
| `imports` | Bitácora de cada importación | `file_name`, `rows_read`, `inserted`, `updated`, `duplicates`, `invalid`, `report jsonb`, `imported_by` |
| `templates` | Catálogo de plantillas | `name unique`, `kind` (`campaign` \| `follow_up`), `rubro` (null para seguimiento), `language` (es_AR), `category` (MARKETING), `body`, `footer`, `buttons jsonb`, `status` (`approved` \| `pending` \| `rejected` \| `paused` \| `disabled`), `quality` |
| `campaigns` | Campaña | `name`, `status` (`draft` \| `sending` \| `paused` \| `completed` \| `cancelled`), `pause_reason`, `pause_error_code`, `paused_at`, `max_follow_ups int default 1`, `confirmed_at`, `created_by` |
| `campaign_filters` | Filtros elegidos | `campaign_id`, `field` (`rubro` \| `zona`), `value` |
| `messages` | Una fila por envío | `campaign_id`, `contact_id`, `template_id`, `kind` (`campaign` \| `follow_up` \| `legacy`), `parent_message_id`, `follow_up_rule_id`, `variables jsonb`, `status` (`queued` \| `sending` \| `sent` \| `delivered` \| `read` \| `failed` \| `cancelled` \| `unknown`), `wamid unique`, `attempts`, `next_attempt_at`, `locked_at`, `queued_at`, `sent_at`, `delivered_at`, `read_at`, `failed_at`, `error_code`, `error_title`, `error_details`, `pricing jsonb`, `billable bool`, `pricing_category`, `estimated_cost numeric` |
| `message_events` | Log crudo del webhook | `received_at`, `wamid`, `event_type` (`status` \| `message` \| `template` \| `other`), `status`, `event_ts`, `payload jsonb`, `processed_at`, `processing_error`; único `(wamid, status, event_ts)` para statuses |
| `inbound_messages` | Respuestas entrantes | `wa_message_id unique`, `contact_id`, `from_phone`, `context_wamid`, `message_id` (envío al que responde), `type` (`text` \| `button` \| `interactive` \| otros), `text`, `button_payload`, `received_at`, `intent` (`interested` \| `opt_out` \| `other`) |
| `opt_outs` | Bajas | `wa_phone unique`, `contact_id`, `source` (`button` \| `keyword` \| `manual` \| `legacy_file`), `inbound_message_id`, `created_at` |
| `follow_up_rules` | Reglas por campaña | `campaign_id`, `step int`, `trigger` (`read_no_reply` \| `delivered_not_read`), `delay_days int`, `template_id`, `active bool` |
| `app_settings` | Configuración (fila única) | `daily_cap int default 200`, `batch_size int default 50`, `send_window_start time default 09:00`, `send_window_end time default 20:00`, `timezone default America/Argentina/Buenos_Aires`, `marketing_rate_usd numeric`, `sending_halted bool`, `halt_reason` |

Restricciones que sostienen las reglas de negocio:
- `unique (contact_id, template_id) where kind in ('campaign','legacy') and status <> 'cancelled'`: la misma plantilla de campaña nunca se encola dos veces a un número, ni siquiera entre campañas distintas.
- `unique (parent_message_id, follow_up_rule_id)`: un seguimiento por regla y por mensaje original.
- Las bajas viven en `opt_outs` (y se reflejan en `contacts.opted_out_at`); la importación nunca las borra.
- Vista `campaign_stats` y vista `campaign_contact_rows` para el panel.

Alternativa descartada: guardar el estado en el contacto (como el Excel). No soporta varias campañas ni seguimientos.

### 2. Importación

El navegador parsea el `.xlsx` con SheetJS y manda las filas normalizadas en tandas de 1.000 a un server action, que llama a una función SQL `import_contacts(rows jsonb, import_id)` con `insert ... on conflict (wa_phone) do update`. Así se evita el límite de 4,5 MB de cuerpo de Vercel y cada tanda es una transacción.

- Normalización de teléfono: solo dígitos; válido si matchea `^549\d{10}$`. Inválidos se reportan y no se importan.
- Duplicados dentro del archivo: gana la primera fila por `ID` (prefiriendo una con `Enviar=SI`); si alguna de las filas duplicadas tiene `Enviar=NO`, el contacto queda con `send_allowed=false` (criterio conservador), salvo que el motivo sea "Teléfono repetido": la segmentación ya marca así las copias (110 casos en la base actual) y contarlas bloquearía al contacto original.
- El upsert actualiza datos descriptivos y `send_allowed`, pero nunca toca `messages`, `opt_outs` ni `opted_out_at`.
- Historial previo: si "Estado envío" empieza con "enviado", se crea un `messages` con `kind='legacy'`, `status='sent'` y la plantilla de la columna Plantilla (on conflict do nothing). `bajas.txt` y `envios_log.csv` se pueden subir aparte en la misma pantalla.
- Las plantillas se siembran desde la hoja "Plantillas" (seed SQL), con `status='approved'` para las 11 ya aprobadas.

### 3. Cola de envío e idempotencia

La cola es la propia tabla `messages`. No se agrega un broker (Upstash/QStash, SQS) porque el volumen es bajo (≤ 250/día) y Postgres ya da transacciones y locks.

1. **Confirmar campaña** (función SQL `enqueue_campaign(campaign_id)`, una transacción): resuelve el público con los filtros, excluye `send_allowed=false`, bajas, contactos sin plantilla aprobada y los que ya recibieron esa plantilla, e inserta filas `queued` con `on conflict do nothing`. Las variables se congelan en `messages.variables` en ese momento.
2. **Despacho**: `pg_cron` llama cada 10 minutos (`*/10 * * * *`) a `POST /api/cron/dispatch` vía `pg_net.http_post` con `Authorization: Bearer <CRON_SECRET>`. La ruta:
   - Sale sin hacer nada si está fuera de la ventana horaria, si `sending_halted` o si no quedan cupos.
   - Calcula `cupo = daily_cap − destinatarios únicos con sent_at/attempt en las últimas 24 h (ventana móvil)` y toma `min(cupo, batch_size)`.
   - Reclama filas con la función `claim_messages(n)`: `update ... set status='sending', locked_at=now(), attempts=attempts+1 where id in (select ... where status='queued' and next_attempt_at <= now() and campaign.status='sending' order by queued_at for update skip locked limit n) returning *`. Dos ejecuciones simultáneas nunca toman la misma fila.
   - Antes de cada llamada vuelve a chequear que el contacto no se haya dado de baja.
   - Llama a `POST https://graph.facebook.com/{WA_API_VERSION}/{WA_PHONE_NUMBER_ID}/messages` con la plantilla, el idioma, los dos parámetros del cuerpo y payloads de los botones (`ME_INTERESA`, `NO_GRACIAS`), secuencialmente con ~300 ms entre llamadas (50 mensajes ≈ 20 s, holgado dentro del timeout de la función).
   - Éxito: guarda `wamid`, `status='sent'`, `sent_at`.
3. **Ventana de incertidumbre**: si la función muere después de que Meta aceptó pero antes de guardar el `wamid`, la fila queda en `sending`. Un barrido marca como `unknown` las filas `sending` con `locked_at` de más de 15 minutos y **no las reintenta**; el panel las muestra para revisión manual. Si después llega un webhook con ese teléfono y plantilla, se puede conciliar. Preferimos perder un envío a duplicarlo.
4. Una campaña pasa a `completed` cuando no le quedan filas `queued`/`sending`.

Alternativa descartada: despachar todo en el request de confirmación. Rompe el tope diario y los timeouts de Vercel.

### 4. Rate limits, reintentos y pausas

Clasificación de la respuesta de Meta:

| Caso | Acción |
|---|---|
| HTTP 401/403, error 190 (token) | Pausa la campaña **y** `sending_halted=true` (afecta a todas), con motivo visible. |
| 131048 (spam rate limit), 131049 (límite de marketing por ecosistema), 131056 (pair rate limit), 130429 (throughput) | Pausa la campaña con `pause_error_code`; el mensaje vuelve a `queued` con `next_attempt_at` futuro (no se cuenta como fallido definitivo). |
| 132000, 132001, 132012, 132015, 132016 (plantilla inexistente, parámetros, pausada o deshabilitada) | Pausa la campaña y marca la plantilla con el estado correspondiente. |
| 5xx, timeout, 131000 / 1 / 2 (errores transitorios) | Reintento con backoff exponencial (5 min, 30 min, 2 h), máximo 3 intentos; después `failed`. |
| Otros 4xx (número inválido 131026, 100 parámetro) | `failed` definitivo con código y detalle. |

Reanudar una campaña pausada es manual, desde el panel, y requiere que el usuario vea el motivo. Para 401/403 además hay que limpiar `sending_halted` desde configuración.

### 5. Webhook

`/api/webhooks/whatsapp` (runtime Node.js, sin caché):
- **GET**: si `hub.mode=subscribe` y `hub.verify_token === WA_VERIFY_TOKEN`, responde 200 con `hub.challenge` en texto plano; si no, 403.
- **POST**: lee el cuerpo crudo (`await req.text()`), calcula `sha256=` + HMAC-SHA256 con `WA_APP_SECRET` y compara con `X-Hub-Signature-256` usando `crypto.timingSafeEqual`. Firma ausente o inválida → 401 y no se guarda nada.
- Con firma válida guarda cada evento en `message_events` y procesa en la misma request (el volumen es bajo); siempre responde 200 rápido, incluso si el procesamiento de un evento falla (queda `processing_error` para reprocesar), para que Meta no reintente en loop.
- Se usa el cliente de Supabase con service role (el webhook no tiene sesión); el resto de la app usa la sesión del usuario.

**Estados monotónicos**: función SQL `apply_status(wamid, status, ts, error, pricing)`:
- Rango `sent=1 < delivered=2 < read=3`. Cada timestamp se setea con `coalesce` (el primero gana) y `status` se actualiza solo si el rango nuevo es mayor. Un `read` sin `delivered` previo implica entregado: `delivered_at = coalesce(delivered_at, ts)`.
- `failed` va aparte: setea `failed_at` y el error; `status` pasa a `failed` solo si no hay `delivered_at`/`read_at`. Un `delivered` posterior a un `failed` no lo revive como fallido en métricas de entrega.
- Eventos duplicados chocan con el único de `message_events` y se ignoran.
- Si el `wamid` aún no existe (webhook antes que el commit del envío), el evento queda sin procesar y el barrido de cada despacho los reprocesa.

**Pricing y costo**: se guarda el objeto `pricing` completo (`billable`, `pricing_model`, `category`, `type`). Meta no informa el monto en el webhook, así que `estimated_cost = billable ? marketing_rate_usd : 0`, con la tarifa configurable en `app_settings` (tarifa de marketing para Argentina de la lista de precios de Meta).

**Respuestas**: se registran `text`, `button` (respuesta a botón de plantilla: `button.text` y `button.payload`) e `interactive`. El vínculo con el envío sale de `context.id` (= `wamid`); si no viene, se asocia al último envío al número. Intención:
- `opt_out`: botón con payload `NO_GRACIAS` o texto "No, gracias", o texto que contenga la palabra BAJA (sin distinguir mayúsculas ni acentos, como palabra completa). Crea `opt_outs`, setea `contacts.opted_out_at` y cancela los `messages` `queued` del contacto.
- `interested`: payload `ME_INTERESA` o texto "Me interesa".

**Plantillas**: si llegan eventos `message_template_status_update` / `message_template_quality_update`, actualizan `templates.status`/`quality`; una plantilla que pasa a `paused`/`disabled` pausa las campañas que la usan.

### 6. Seguimientos

- `pg_cron` diario (`0 13 * * *` UTC = 10:00 ART) → `POST /api/cron/follow-ups` con `CRON_SECRET`.
- La ruta llama a `enqueue_follow_ups()`, que para cada regla activa busca mensajes originales (campaña o seguimiento previo del mismo contacto) que cumplan el disparador:
  - `read_no_reply`: `read_at <= now() - delay_days` y sin `inbound_messages` del contacto posteriores al envío.
  - `delivered_not_read`: `delivered_at <= now() - delay_days`, `read_at is null`, sin respuestas.
- Excluye: contactos con baja, mensajes con `failed_at`, contactos que respondieron cualquier cosa después del primer envío de la campaña, y contactos que ya llegaron a `campaigns.max_follow_ups`.
- Inserta `messages` `kind='follow_up'` en `queued` con `on conflict do nothing`; los despacha el mismo dispatcher y **comparten el tope diario** con los envíos de campaña.
- Solo se aceptan plantillas `kind='follow_up'` con `status='approved'`. Como cualquier respuesta corta la secuencia, un seguimiento siempre cae fuera de la ventana de 24 h y por eso v1 nunca manda texto libre.

Alternativa descartada: Vercel Cron. El plan Hobby limita frecuencia y cantidad; `pg_cron` deja el agendado junto a los datos y versionado en migraciones.

### 7. Seguridad y RLS

- RLS habilitado en **todas** las tablas. Política única por tabla para el rol `authenticated`: `select/insert/update/delete using (true)`. `anon` no tiene políticas, así que no accede a nada.
- Registro público deshabilitado en Supabase Auth; el admin crea los usuarios (email + contraseña) desde el panel de Supabase. Middleware de Next.js redirige a `/login` sin sesión.
- Webhook y rutas de cron usan `SUPABASE_SERVICE_ROLE_KEY` solo del lado del servidor. Las rutas de cron validan `Authorization: Bearer ${CRON_SECRET}` con comparación de tiempo constante.
- El `CRON_SECRET` que usa `pg_net` se guarda en Supabase Vault y se lee desde la función del job, no en texto plano en `cron.job`.
- `WA_TOKEN` nunca llega al cliente.

### 8. Variables de entorno

| Variable | Uso |
|---|---|
| `WA_TOKEN` | Token permanente del usuario del sistema de Meta. |
| `WA_PHONE_NUMBER_ID` | ID del número emisor. |
| `WA_APP_SECRET` | Secreto de la app de Meta para validar `X-Hub-Signature-256`. |
| `WA_VERIFY_TOKEN` | Token de verificación del webhook (GET). |
| `WA_API_VERSION` | Versión de Graph API, ej. `v23.0`. |
| `CRON_SECRET` | Secreto compartido entre `pg_cron`/`pg_net` y las rutas `/api/cron/*`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase. |
| (Vault) `app_base_url`, `cron_secret` | URL pública de la app y copia de `CRON_SECRET`, guardadas en Supabase Vault: las lee `pg_cron` para llamar a las rutas. No son variables de Vercel. |

## Risks / Trade-offs

- **Calidad del número y bloqueos por exceso de seguimientos** → default de 1 seguimiento por contacto, mínimo de días configurable por regla, corte ante cualquier respuesta o baja, tope diario compartido, ventana horaria hábil, botón de baja en todas las plantillas y pausa automática ante 131048/131049. Se monitorea la calidad (`phone_number_quality_update`, `message_template_quality_update`) y se recomienda no activar `delivered_not_read` hasta tener datos de la primera campaña.
- **Confiabilidad del estado "read"** → solo llega si el destinatario tiene activadas las confirmaciones de lectura; muchos usuarios las desactivan. Consecuencias: "leídos" es un piso, no el total; la regla `delivered_not_read` va a disparar seguimientos a gente que sí leyó. El panel lo aclara junto a la métrica y la regla lo advierte al crearla.
- **Envío en estado incierto (`unknown`)** → se prioriza no duplicar; revisión manual en el panel.
- **Webhooks perdidos o fuera de orden** → estados monotónicos, log crudo en `message_events` y reprocesamiento de eventos huérfanos.
- **131049 y 131056 son límites por destinatario**, no de cuenta; pausar toda la campaña por uno es conservador y puede frenar envíos válidos → se acepta en v1 por prudencia con un número nuevo; ver Open Questions.
- **Costo estimado ≠ factura real** → depende de la tarifa cargada a mano y del modelo de precios vigente de Meta; se rotula como "estimado".
- **Excel con estructura distinta** → la importación valida encabezados requeridos y aborta con un mensaje claro antes de escribir.
- **`pg_net` es asíncrono** y no reintenta → si una corrida falla, la siguiente (10 min) la cubre; el job diario de seguimientos es idempotente y se puede disparar a mano desde el panel.

## Migration Plan

1. Crear proyecto Supabase, habilitar `pg_cron`, `pg_net` y Vault; correr migraciones y seed de plantillas.
2. Deploy en Vercel con las variables de entorno; configurar el webhook en la app de Meta (URL + `WA_VERIFY_TOKEN`) y suscribir `messages` y `message_template_status_update`.
3. Importar el Excel, `bajas.txt` y (si existe) `envios_log.csv`; verificar conteos contra la hoja "Resumen".
4. Cargar `gen12_seguimiento_1` en Meta y marcarla aprobada cuando Meta la apruebe.
5. Campaña piloto chica (≤ 20 contactos) a números internos y luego a un rubro/zona acotado.
6. Retirar `enviar_whatsapp.py` del uso diario.

Rollback: desactivar los jobs de `pg_cron` (`cron.unschedule`) y poner `sending_halted=true` detiene todo envío; los datos quedan intactos.

## Open Questions

- ¿Pausar la campaña entera ante 131049/131056 o solo reprogramar ese destinatario? (v1: pausar, por pedido explícito.)
- ¿Agregar `WA_BUSINESS_ACCOUNT_ID` para sincronizar el estado de plantillas por la Graph API en lugar de marcarlo a mano + webhook?
- Tarifa de marketing para Argentina a cargar en `marketing_rate_usd` y moneda de visualización.
- ¿Los contactos "Sin rubro identificado" (5.829) entran por defecto en los filtros o requieren elegirlos explícitamente? (v1: aparecen como un rubro más, "Sin rubro identificado", con `gen12_general`.)
- ¿Notificar al equipo (mail/Slack) cuando alguien toca "Me interesa"? Queda fuera de v1.
