-- Gen12 · RLS: v1 sin roles. Todo usuario autenticado tiene acceso total; anon no accede a nada.
-- El webhook y los jobs usan la service role (bypassa RLS) solo del lado del servidor.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'app_settings', 'imports', 'contacts', 'templates', 'campaigns', 'campaign_filters',
    'follow_up_rules', 'messages', 'message_events', 'inbound_messages', 'opt_outs'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy "authenticated_full_access" on public.%I for all to authenticated using (true) with check (true)',
      v_table);
  end loop;
end;
$$;

-- Las funciones son security invoker; igual se le quita a anon la posibilidad de llamarlas.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- Las funciones de despacho y webhook solo las usa el servidor.
revoke execute on function
  public.claim_messages(integer),
  public.sweep_dispatch(),
  public.record_send_success(uuid, text),
  public.ingest_status(jsonb),
  public.apply_status(jsonb),
  public.reprocess_pending_statuses(text),
  public.record_inbound(text, text, text, text, text, text, timestamptz, text, jsonb),
  public.update_template_status(text, text, text, text),
  public.is_opted_out(text),
  public.cancel_message(uuid),
  public.release_messages(uuid[], text, text, text),
  public.retry_message(uuid, timestamptz, text, text, text),
  public.fail_message(uuid, text, text, text),
  public.halt_sending(text),
  public.mark_template(text, text, text),
  public.record_webhook_error(jsonb, text),
  public.record_webhook_other(jsonb)
from authenticated;
