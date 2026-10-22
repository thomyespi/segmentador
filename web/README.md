# Gen12 · Campañas de WhatsApp

App interna para mandar campañas de WhatsApp (Cloud API de Meta) a la base segmentada de Gen12, seguir el estado de cada mensaje y mandar seguimientos automáticos.

- **Stack**: Next.js 16 (App Router) en Vercel, Supabase (Postgres + Auth + RLS), WhatsApp Cloud API.
- **Especificación**: `../openspec/changes/add-whatsapp-campaigns/` (proposal, design, specs y tasks).

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Esquema, reglas de negocio, cola, estados, seguimientos | `supabase/migrations/*.sql` (funciones SQL) |
| Despacho de la cola (cada 10 min) | `pg_cron` → `POST /api/cron/dispatch` → `src/lib/dispatch.ts` |
| Seguimientos (todos los días 10:00 ART) | `pg_cron` → `POST /api/cron/follow-ups` → `enqueue_follow_ups()` |
| Webhook de Meta | `GET/POST /api/webhooks/whatsapp` → `src/lib/webhook/` |
| Panel | `src/app/(app)/` |

Reglas que sostiene la base de datos (no la UI):

- Una plantilla de campaña nunca se encola dos veces al mismo número (índice único `messages_template_once_idx`).
- Las bajas se excluyen al encolar y se cancelan los envíos en cola al recibir la baja; el despachador vuelve a chequear antes de cada envío.
- Tope diario = destinatarios únicos en una ventana móvil de 24 h, compartido entre campañas y seguimientos.
- Los estados nunca retroceden (`sent < delivered < read`; `failed` aparte).
- Un envío que se cortó sin saber si Meta lo aceptó queda **incierto** y no se reintenta solo (se resuelve a mano en el detalle de la campaña).

## Desarrollo

```bash
npm install
cp .env.local.example .env.local   # completar
npm run dev
npm test                            # vitest + PGlite (Postgres en WASM, no hace falta Docker)
```

Los tests corren las migraciones reales sobre PGlite, salvo `_cron.sql` (PGlite no tiene `pg_cron`, `pg_net` ni Vault).

## Puesta en marcha

1. **Supabase**
   - Crear el proyecto y aplicar las migraciones: `npx supabase link --project-ref <ref>` y `npx supabase db push`.
   - Auth > Providers > Email: deshabilitar "Allow new users to sign up". Crear los usuarios desde Auth > Users.
   - Cargar los secretos de los jobs en el SQL Editor (una sola vez):
     ```sql
     select vault.create_secret('https://<tu-app>.vercel.app', 'app_base_url');
     select vault.create_secret('<mismo valor que CRON_SECRET>', 'cron_secret');
     ```
2. **Vercel**: crear el proyecto apuntando a esta carpeta y cargar las variables de `.env.local.example`.
3. **Meta** (app de WhatsApp):
   - Webhook: URL `https://<tu-app>.vercel.app/api/webhooks/whatsapp`, token de verificación = `WA_VERIFY_TOKEN`.
   - Suscribir los campos `messages` y `message_template_status_update` (y opcionalmente `message_template_quality_update`).
   - Cargar la plantilla de seguimiento `gen12_seguimiento_1` (texto en Configuración > Plantillas) y marcarla aprobada cuando Meta la apruebe.
4. **Datos**: en *Importar*, subir `Base segmentada Gen12.xlsx`, `bajas.txt` y, si existe, `envios_log.csv` del script anterior.
5. **Piloto**: campaña chica a números internos antes de la primera campaña real.

## Operación

- **Campaña pausada**: el panel muestra el código de Meta y el motivo. Reanudar es manual, después de revisarlo.
- **Envíos frenados (401/403)**: problema de token o de cuenta. Se reactivan desde Configuración.
- **Ver jobs**: `select * from cron.job;` y `select * from cron.job_run_details order by start_time desc limit 20;`
  Las respuestas HTTP de `pg_net` quedan en `net._http_response`.
- **Rollback / parar todo**: `select cron.unschedule('gen12-dispatch'); select cron.unschedule('gen12-follow-ups');`
  o activar el freno: `update app_settings set sending_halted = true, halt_reason = 'Parada manual';`.
- **Eventos del webhook con error**: `select * from message_events where processing_error is not null;`
