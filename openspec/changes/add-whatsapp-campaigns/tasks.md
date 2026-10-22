## 1. Setup del proyecto e infraestructura

- [x] 1.1 Crear el proyecto Next.js (App Router, TypeScript) y agregar `@supabase/supabase-js`, `@supabase/ssr` y SheetJS (`xlsx`)
- [x] 1.2 Crear el proyecto Supabase y habilitar las extensiones `pg_cron`, `pg_net` y Vault
- [ ] 1.3 Configurar variables de entorno en Vercel y `.env.local.example`: `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_API_VERSION`, `CRON_SECRET` y las de Supabase (más `app_base_url` y `cron_secret` en Vault)
- [x] 1.4 Migración base: tablas `contacts`, `imports`, `templates`, `campaigns`, `campaign_filters`, `messages`, `message_events`, `inbound_messages`, `opt_outs`, `follow_up_rules`, `app_settings` con índices y restricciones únicas del design
- [x] 1.5 Habilitar RLS en todas las tablas con política de acceso total para `authenticated` y ninguna para `anon`; test que verifique que la clave anónima sin sesión no lee filas
- [ ] 1.6 Configurar Supabase Auth (registro público deshabilitado, usuarios creados por el admin), pantalla `/login` y middleware que redirige sin sesión
- [x] 1.7 Cliente de la WhatsApp Cloud API (`lib/whatsapp.ts`): envío de plantilla con parámetros de cuerpo y payloads de botones, URL con `WA_API_VERSION`, y clasificación de errores (pausa / reintento / fallido) según la tabla del design

## 2. contact-import

- [x] 2.1 Seed de `templates` con las 11 plantillas de campaña de la hoja "Plantillas" (cuerpo, pie, botones, rubro, `status='approved'`)
- [x] 2.2 Función SQL `import_contacts(rows jsonb, import_id)` con upsert por `wa_phone` que no toca `messages`, `opt_outs` ni `opted_out_at`
- [x] 2.3 Parser en el navegador: leer hoja "Contactos", validar encabezados requeridos, normalizar teléfonos (`^549\d{10}$`) y deduplicar (primera fila por ID; Enviar=NO gana)
- [x] 2.4 Server action que recibe tandas de 1.000 filas, crea el registro en `imports` y acumula totales
- [x] 2.5 Crear envíos `legacy` desde "Estado envío" = "enviado …" con la plantilla de la columna Plantilla
- [x] 2.6 Importación de `bajas.txt` (y opcional `envios_log.csv`) a `opt_outs` / envíos `legacy`
- [x] 2.7 Pantalla de importación con resumen y descarga del detalle de inválidos y duplicados; listado de importaciones
- [x] 2.8 Tests: upsert de contacto existente, número inválido, duplicado con Enviar=NO, reimportación que no revierte una baja ni borra envíos

## 3. campaign-sending

- [x] 3.1 Pantalla de nueva campaña con multiselección de rubro y zona, conteo de elegibles y desglose de excluidos (función SQL `campaign_audience(filters)`)
- [x] 3.2 Vista previa por contacto con el texto final (variables reemplazadas, pie y botones)
- [x] 3.3 Función SQL `enqueue_campaign(campaign_id)` atómica con `on conflict do nothing` y variables congeladas
- [x] 3.4 Función SQL `claim_messages(n)` con `for update skip locked` y cálculo de cupo diario en ventana móvil de 24 h
- [x] 3.5 Ruta `POST /api/cron/dispatch` protegida con `CRON_SECRET`: ventana horaria, `sending_halted`, chequeo de baja previo a cada envío, envío secuencial y guardado de `wamid`
- [x] 3.6 Manejo de errores: pausa de campaña (401/403, 131048, 131049, 131056, 130429, errores 132xxx de plantilla), `sending_halted` ante 401/403, reintentos con backoff (máx. 3) y fallidos definitivos
- [x] 3.7 Barrido de envíos `sending` con más de 15 min → `unknown`, y cierre de campañas sin pendientes → `completed`
- [x] 3.8 Job de `pg_cron` cada 10 minutos que llama a `/api/cron/dispatch` con `pg_net` y el secreto leído de Vault
- [x] 3.9 Pantalla de configuración: tope diario (default 200), tamaño de lote, ventana horaria, tarifa de marketing y reactivación de envíos frenados
- [x] 3.10 Acciones de campaña: confirmar, pausar, reanudar (mostrando el motivo) y cancelar (cancela los `queued`)
- [x] 3.11 Tests: no repetir plantilla por número entre campañas, exclusión de bajas, tope diario, corridas concurrentes, pausa por 131048 y por 401

## 4. message-tracking

- [x] 4.1 Ruta `GET /api/webhooks/whatsapp` para verificación con `WA_VERIFY_TOKEN`
- [x] 4.2 Ruta `POST /api/webhooks/whatsapp`: cuerpo crudo, validación HMAC-SHA256 con `WA_APP_SECRET` y `timingSafeEqual`, guardado en `message_events` y respuesta 200
- [x] 4.3 Función SQL `apply_status(...)` con estados monotónicos (sent < delivered < read, read implica delivered, failed aparte) y guardado de error
- [x] 4.4 Guardado del objeto `pricing` y cálculo de `estimated_cost` con la tarifa de `app_settings`
- [x] 4.5 Registro de mensajes entrantes (`text`, `button`, `interactive`), asociación por `context.id` o último envío, y detección de intención (`interested` / `opt_out`)
- [x] 4.6 Baja automática: botón "No, gracias" / payload `NO_GRACIAS` o palabra BAJA (sin mayúsculas ni acentos, palabra completa); cancelar envíos en cola
- [x] 4.7 Procesar `message_template_status_update` / `message_template_quality_update` y pausar campañas con plantillas pausadas o deshabilitadas
- [x] 4.8 Reprocesamiento de eventos huérfanos (wamid aún no registrado) en cada corrida del dispatcher
- [ ] 4.9 Configurar el webhook en la app de Meta (URL de producción + verify token) y suscribir los campos `messages` y `message_template_status_update`
- [x] 4.10 Test del webhook: firma inválida o ausente → 401 y nada guardado
- [x] 4.11 Test del webhook: estados desordenados (read antes que delivered, delivered después de read) → el estado no retrocede y se guardan ambas fechas
- [x] 4.12 Test del webhook: baja por botón "No, gracias" → registro en `opt_outs`, `opted_out_at` seteado y envíos en cola cancelados
- [x] 4.13 Tests del webhook: evento duplicado ignorado, baja por texto "baja", "Bahía Blanca" no genera baja, verificación GET correcta e incorrecta

## 5. follow-up-automation

- [ ] 5.1 Cargar en Meta la plantilla de seguimiento `gen12_seguimiento_1` (MARKETING, es_AR, ejemplos {{1}} "Octavio", {{2}} "369 Seguridad y Energía") y registrarla en `templates` con `kind='follow_up'`. Texto propuesto:
  - Cuerpo: "Hola {{1}}, te escribo de nuevo desde Gen12 Software. Hace unos días te conté cómo ayudamos a empresas como {{2}} con su web, sus formularios de consulta y la automatización de tareas del día a día.\n\nSi te sirve, en una llamada de 15 minutos te muestro un par de ejemplos concretos de tu rubro, sin compromiso. ¿Te parece?"
  - Pie: "gen12software.com · Respondé BAJA si no querés recibir más mensajes"
  - Botones de respuesta rápida: "Me interesa" / "No, gracias"
- [ ] 5.2 Marcar `gen12_seguimiento_1` como aprobada cuando Meta la apruebe (manual o por webhook de estado de plantilla)
- [x] 5.3 UI de reglas por campaña: disparador, días, plantilla (solo seguimientos aprobados), orden, activar/desactivar, máximo de seguimientos (default 1) y advertencia sobre "read"
- [x] 5.4 Función SQL `enqueue_follow_ups()` idempotente: disparadores `read_no_reply` y `delivered_not_read`, corte por respuesta, baja o fallo, tope por contacto y plantilla aprobada
- [x] 5.5 Ruta `POST /api/cron/follow-ups` protegida con `CRON_SECRET` y botón para dispararla a mano desde el panel
- [x] 5.6 Job diario de `pg_cron` (10:00 ART) que llama a `/api/cron/follow-ups` con `pg_net`
- [x] 5.7 Tests: seguimiento a los N días, días no cumplidos, contacto que respondió, baja, envío fallido, tope de 1, doble ejecución sin duplicados, llamada sin secreto → 401

## 6. campaign-dashboard

- [x] 6.1 Vista SQL `campaign_stats` (en cola, enviados, entregados incluyendo leídos, leídos, fallidos, inciertos, respondieron, "Me interesa", bajas, costo estimado), separando originales y seguimientos
- [x] 6.2 Listado de campañas con estado, avance, cupo diario disponible y aviso de pausa con código y motivo
- [x] 6.3 Detalle de campaña con las métricas, aclaración sobre "read" y rótulo de costo estimado
- [x] 6.4 Vista SQL `campaign_contact_rows` y tabla por contacto paginada con estado, fechas, error, seguimientos y última respuesta
- [x] 6.5 Filtros (estado, rubro, zona, respondió, "Me interesa", baja) y búsqueda por nombre, empresa o número
- [x] 6.6 Ruta de exportación CSV con los filtros aplicados (UTF-8 con BOM)
- [x] 6.7 Sección de envíos `unknown` para revisión manual

## 7. Puesta en marcha

- [ ] 7.1 Importar el Excel, `bajas.txt` y (si existe) `envios_log.csv`; contrastar conteos con la hoja "Resumen"
- [ ] 7.2 Campaña piloto a números internos (≤ 20) verificando estados, respuestas, baja y costo en el panel
- [ ] 7.3 Primera campaña real acotada (un rubro y una zona) y revisión de la calidad del número antes de activar seguimientos
- [ ] 7.4 Documentar en un README la operación (configuración de Meta, jobs de `pg_cron`, reactivar envíos, rollback) y dejar de usar `enviar_whatsapp.py`
