-- Gen12 · Jobs programados con pg_cron + pg_net (no dependemos de los crons de Vercel).
-- Antes de que los jobs funcionen hay que cargar dos secretos en Vault (una sola vez, fuera del repo):
--   select vault.create_secret('https://<tu-app>.vercel.app', 'app_base_url');
--   select vault.create_secret('<mismo valor que CRON_SECRET>', 'cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Llama a una ruta protegida de la app con Authorization: Bearer <cron_secret>.
create or replace function private.call_app(p_path text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'Faltan los secretos app_base_url / cron_secret en Vault';
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

revoke execute on function private.call_app(text) from public, anon, authenticated;

-- Despacho de la cola cada 10 minutos (la ruta respeta ventana horaria, cupo y frenos).
select cron.schedule('gen12-dispatch', '*/10 * * * *', $$select private.call_app('/api/cron/dispatch')$$);

-- Evaluación diaria de seguimientos: 13:00 UTC = 10:00 hora de Argentina.
select cron.schedule('gen12-follow-ups', '0 13 * * *', $$select private.call_app('/api/cron/follow-ups')$$);
