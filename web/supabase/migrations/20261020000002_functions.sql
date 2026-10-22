-- Gen12 · Campañas de WhatsApp: funciones y vistas.

-- ---------------------------------------------------------------------------
-- Bajas
-- ---------------------------------------------------------------------------

create or replace function public.register_opt_out(
  p_phone text,
  p_source text,
  p_inbound_message_id uuid default null,
  p_at timestamptz default now()
) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_contact_id uuid;
  v_inserted boolean;
begin
  select id into v_contact_id from public.contacts where wa_phone = p_phone;

  insert into public.opt_outs (wa_phone, contact_id, source, inbound_message_id, created_at)
  values (p_phone, v_contact_id, p_source, p_inbound_message_id, p_at)
  on conflict (wa_phone) do nothing;
  v_inserted := found;

  if v_contact_id is not null then
    update public.contacts set opted_out_at = coalesce(opted_out_at, p_at) where id = v_contact_id;
    update public.messages set status = 'cancelled'
      where contact_id = v_contact_id and status = 'queued';
  end if;

  return v_inserted;
end;
$$;

create or replace function public.import_opt_outs(p_phones text[]) returns integer
language plpgsql set search_path = '' as $$
declare
  v_phone text;
  v_count integer := 0;
begin
  foreach v_phone in array p_phones loop
    if public.register_opt_out(v_phone, 'legacy_file') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Importación de contactos
-- ---------------------------------------------------------------------------

-- p_rows: [{wa_phone, excel_id, contact_name, company, rubro, rubro_source, zona, zona_source,
--           var_1, var_2, template_name, send_allowed, exclusion_reason, original, legacy_sent}]
-- Nunca toca messages (salvo agregar envíos legacy), opt_outs ni opted_out_at.
create or replace function public.import_contacts(p_import_id uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_inserted integer;
  v_updated integer;
  v_legacy integer;
begin
  with input as (
    select * from jsonb_to_recordset(p_rows) as r(
      wa_phone text, excel_id text, contact_name text, company text, rubro text, rubro_source text,
      zona text, zona_source text, var_1 text, var_2 text, template_name text,
      send_allowed boolean, exclusion_reason text, original jsonb, legacy_sent boolean)
  ),
  upserted as (
    insert into public.contacts as c (
      wa_phone, excel_id, contact_name, company, rubro, rubro_source, zona, zona_source,
      var_1, var_2, template_name, send_allowed, exclusion_reason, original, last_import_id)
    select wa_phone, excel_id, contact_name, company, rubro, rubro_source, zona, zona_source,
      var_1, var_2, template_name, coalesce(send_allowed, true), exclusion_reason,
      coalesce(original, '{}'::jsonb), p_import_id
    from input
    on conflict (wa_phone) do update set
      excel_id = excluded.excel_id,
      contact_name = excluded.contact_name,
      company = excluded.company,
      rubro = excluded.rubro,
      rubro_source = excluded.rubro_source,
      zona = excluded.zona,
      zona_source = excluded.zona_source,
      var_1 = excluded.var_1,
      var_2 = excluded.var_2,
      template_name = excluded.template_name,
      send_allowed = excluded.send_allowed,
      exclusion_reason = excluded.exclusion_reason,
      original = excluded.original,
      last_import_id = excluded.last_import_id
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert), count(*) filter (where not is_insert)
    into v_inserted, v_updated
  from upserted;

  -- Historial del script anterior: "Estado envío" = enviado → envío legacy de esa plantilla.
  insert into public.messages (contact_id, template_id, kind, status, sent_at, queued_at, variables)
  select c.id, t.id, 'legacy', 'sent', now(), now(), jsonb_build_array(c.var_1, c.var_2)
  from jsonb_to_recordset(p_rows) as r(wa_phone text, template_name text, legacy_sent boolean)
  join public.contacts c on c.wa_phone = r.wa_phone
  join public.templates t on t.name = r.template_name and t.kind = 'campaign'
  where r.legacy_sent
  on conflict do nothing;
  get diagnostics v_legacy = row_count;

  update public.imports set
    inserted = inserted + v_inserted,
    updated = updated + v_updated,
    legacy_sends = legacy_sends + v_legacy
  where id = p_import_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'legacy_sends', v_legacy);
end;
$$;

-- Envíos registrados por enviar_whatsapp.py (envios_log.csv): p_rows = [{wa_phone, template_name}]
create or replace function public.import_legacy_sends(p_rows jsonb) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.messages (contact_id, template_id, kind, status, sent_at, queued_at, variables)
  select c.id, t.id, 'legacy', 'sent', now(), now(), jsonb_build_array(c.var_1, c.var_2)
  from jsonb_to_recordset(p_rows) as r(wa_phone text, template_name text)
  join public.contacts c on c.wa_phone = r.wa_phone
  join public.templates t on t.name = r.template_name and t.kind = 'campaign'
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audiencia de campañas
-- ---------------------------------------------------------------------------

create or replace function public.contact_facets()
returns table (field text, value text, total bigint)
language sql stable set search_path = '' as $$
  select 'rubro', coalesce(rubro, ''), count(*) from public.contacts group by rubro
  union all
  select 'zona', coalesce(zona, ''), count(*) from public.contacts group by zona
  order by 1, 3 desc;
$$;

-- Un contacto por fila con la plantilla que le corresponde y el motivo de exclusión (null = elegible).
-- Arrays vacíos o null en un filtro = sin filtrar por ese campo.
create or replace function public.campaign_candidates(p_rubros text[], p_zonas text[])
returns table (contact_id uuid, template_id uuid, exclusion text)
language sql stable set search_path = '' as $$
  select
    c.id,
    coalesce(tn.id, tr.id),
    case
      when not c.send_allowed then 'enviar_no'
      when c.opted_out_at is not null
        or exists (select 1 from public.opt_outs o where o.wa_phone = c.wa_phone) then 'baja'
      when coalesce(tn.id, tr.id) is null then 'sin_plantilla'
      when coalesce(tn.status, tr.status) <> 'approved' then 'plantilla_no_aprobada'
      when nullif(btrim(c.var_1), '') is null or nullif(btrim(c.var_2), '') is null then 'sin_variables'
      when exists (
        select 1 from public.messages m
        where m.contact_id = c.id and m.template_id = coalesce(tn.id, tr.id)
          and m.kind in ('campaign', 'legacy') and m.status <> 'cancelled'
      ) then 'ya_recibida'
    end
  from public.contacts c
  left join public.templates tn on tn.kind = 'campaign' and tn.name = c.template_name
  left join public.templates tr on tr.kind = 'campaign' and tr.rubro = c.rubro
  where (coalesce(cardinality(p_rubros), 0) = 0 or c.rubro = any (p_rubros))
    and (coalesce(cardinality(p_zonas), 0) = 0 or c.zona = any (p_zonas));
$$;

create or replace function public.campaign_audience_counts(p_rubros text[], p_zonas text[])
returns table (exclusion text, total bigint)
language sql stable set search_path = '' as $$
  select exclusion, count(*) from public.campaign_candidates(p_rubros, p_zonas) group by exclusion;
$$;

create or replace function public.campaign_preview(
  p_rubros text[], p_zonas text[], p_limit integer default 20, p_offset integer default 0)
returns table (
  contact_id uuid, wa_phone text, contact_name text, company text, rubro text, zona text,
  var_1 text, var_2 text, template_name text, body text, footer text, buttons jsonb)
language sql stable set search_path = '' as $$
  select c.id, c.wa_phone, c.contact_name, c.company, c.rubro, c.zona, c.var_1, c.var_2,
    t.name, t.body, t.footer, t.buttons
  from public.campaign_candidates(p_rubros, p_zonas) cc
  join public.contacts c on c.id = cc.contact_id
  join public.templates t on t.id = cc.template_id
  where cc.exclusion is null
  order by c.company, c.id
  limit p_limit offset p_offset;
$$;

-- Confirma la campaña: encola en una sola transacción, congelando plantilla y variables.
create or replace function public.enqueue_campaign(p_campaign_id uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_rubros text[];
  v_zonas text[];
  v_count integer;
begin
  select status into v_status from public.campaigns where id = p_campaign_id for update;
  if v_status is null then
    raise exception 'Campaña inexistente';
  end if;
  if v_status <> 'draft' then
    raise exception 'La campaña ya fue confirmada (estado %)', v_status;
  end if;

  select array_agg(value) filter (where field = 'rubro'), array_agg(value) filter (where field = 'zona')
    into v_rubros, v_zonas
  from public.campaign_filters where campaign_id = p_campaign_id;

  insert into public.messages (campaign_id, contact_id, template_id, kind, variables)
  select p_campaign_id, cc.contact_id, cc.template_id, 'campaign', jsonb_build_array(c.var_1, c.var_2)
  from public.campaign_candidates(v_rubros, v_zonas) cc
  join public.contacts c on c.id = cc.contact_id
  where cc.exclusion is null
  on conflict do nothing;
  get diagnostics v_count = row_count;

  update public.campaigns set status = 'sending', confirmed_at = now() where id = p_campaign_id;
  return v_count;
end;
$$;

create or replace function public.cancel_campaign(p_campaign_id uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  update public.campaigns set status = 'cancelled'
    where id = p_campaign_id and status in ('draft', 'sending', 'paused');
  update public.messages set status = 'cancelled'
    where campaign_id = p_campaign_id and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Despacho
-- ---------------------------------------------------------------------------

create or replace function public.in_send_window(p_at timestamptz default now()) returns boolean
language sql stable set search_path = '' as $$
  select (p_at at time zone s.timezone)::time >= s.send_window_start
     and (p_at at time zone s.timezone)::time < s.send_window_end
  from public.app_settings s;
$$;

-- Destinatarios únicos en la ventana móvil de 24 h (enviados o en vuelo).
create or replace function public.recipients_last_24h() returns integer
language sql stable set search_path = '' as $$
  select count(distinct contact_id)::integer
  from public.messages
  where kind <> 'legacy'
    and (sent_at > now() - interval '24 hours'
      or (status in ('sending', 'unknown') and locked_at > now() - interval '24 hours'));
$$;

-- Toma hasta p_limit envíos de la cola respetando tope diario, ventana horaria y frenos.
-- FOR UPDATE SKIP LOCKED: dos corridas concurrentes nunca toman la misma fila.
create or replace function public.claim_messages(p_limit integer)
returns table (
  message_id uuid, campaign_id uuid, kind text, wa_phone text, template_name text,
  language text, variables jsonb, attempts integer)
language plpgsql set search_path = '' as $$
declare
  v_settings public.app_settings;
  v_n integer;
begin
  select * into v_settings from public.app_settings;
  if v_settings.sending_halted or not public.in_send_window() then
    return;
  end if;

  -- Bajas o exclusiones posteriores al encolado.
  update public.messages m set status = 'cancelled'
  from public.contacts c
  where m.contact_id = c.id and m.status = 'queued'
    and (c.opted_out_at is not null or not c.send_allowed
      or exists (select 1 from public.opt_outs o where o.wa_phone = c.wa_phone));

  v_n := least(p_limit, v_settings.daily_cap - public.recipients_last_24h());
  if v_n <= 0 then
    return;
  end if;

  return query
  with picked as (
    select m.id
    from public.messages m
    join public.campaigns ca on ca.id = m.campaign_id
    join public.templates t on t.id = m.template_id
    where m.status = 'queued'
      and m.next_attempt_at <= now()
      and ca.status in ('sending', 'completed')
      and t.status = 'approved'
    order by m.queued_at, m.id
    limit v_n
    for update of m skip locked
  ),
  claimed as (
    update public.messages m
    set status = 'sending', locked_at = now(), attempts = m.attempts + 1
    from picked
    where m.id = picked.id
    returning m.id, m.campaign_id, m.kind, m.contact_id, m.template_id, m.variables, m.attempts
  )
  select cl.id, cl.campaign_id, cl.kind, c.wa_phone, t.name, t.language, cl.variables, cl.attempts
  from claimed cl
  join public.contacts c on c.id = cl.contact_id
  join public.templates t on t.id = cl.template_id;
end;
$$;

-- Barrido: envíos colgados → unknown (no se reintentan) y cierre de campañas sin pendientes.
create or replace function public.sweep_dispatch() returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_unknown integer;
  v_completed integer;
begin
  update public.messages set status = 'unknown'
    where status = 'sending' and locked_at < now() - interval '15 minutes';
  get diagnostics v_unknown = row_count;

  update public.campaigns ca set status = 'completed', completed_at = now()
  where ca.status = 'sending'
    and not exists (
      select 1 from public.messages m
      where m.campaign_id = ca.id and m.kind = 'campaign' and m.status in ('queued', 'sending'));
  get diagnostics v_completed = row_count;

  return jsonb_build_object('unknown', v_unknown, 'completed', v_completed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Estados (webhook)
-- ---------------------------------------------------------------------------

create or replace function public.status_rank(p_status text) returns integer
language sql immutable set search_path = '' as $$
  select case p_status
    when 'sent' then 1
    when 'delivered' then 2
    when 'read' then 3
    when 'failed' then 100 -- un fallido no se pisa con estados de avance
    else 0
  end;
$$;

-- Aplica un status de Meta a un envío. sent < delivered < read; failed aparte. Nunca retrocede.
-- Devuelve false si el wamid todavía no existe.
create or replace function public.apply_status(p_status jsonb) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_status text := p_status ->> 'status';
  v_ts timestamptz := to_timestamp((p_status ->> 'timestamp')::bigint);
  v_error jsonb := p_status -> 'errors' -> 0;
  v_pricing jsonb := p_status -> 'pricing';
  v_billable boolean := (p_status -> 'pricing' ->> 'billable')::boolean;
begin
  update public.messages m set
    sent_at = case when v_status in ('sent', 'delivered', 'read') then least(m.sent_at, v_ts) else m.sent_at end,
    delivered_at = case when v_status in ('delivered', 'read') then least(m.delivered_at, v_ts) else m.delivered_at end,
    read_at = case when v_status = 'read' then least(m.read_at, v_ts) else m.read_at end,
    failed_at = case when v_status = 'failed' then least(m.failed_at, v_ts) else m.failed_at end,
    error_code = case when v_status = 'failed' then v_error ->> 'code' else m.error_code end,
    error_title = case when v_status = 'failed' then coalesce(v_error ->> 'title', v_error ->> 'message') else m.error_title end,
    error_details = case when v_status = 'failed'
      then coalesce(v_error -> 'error_data' ->> 'details', v_error ->> 'message') else m.error_details end,
    status = case
      when v_status = 'failed' then
        case when m.delivered_at is null and m.read_at is null then 'failed' else m.status end
      when public.status_rank(v_status) > public.status_rank(m.status) then v_status
      else m.status
    end,
    pricing = coalesce(v_pricing, m.pricing),
    billable = coalesce(v_billable, m.billable),
    pricing_category = coalesce(v_pricing ->> 'category', m.pricing_category),
    estimated_cost = case
      when coalesce(v_billable, m.billable) then (select s.marketing_rate_usd from public.app_settings s)
      when coalesce(v_billable, m.billable) = false then 0
      else m.estimated_cost
    end
  where m.wamid = p_status ->> 'id';
  return found;
end;
$$;

-- Registra un status crudo y lo aplica. 'duplicate' | 'applied' | 'pending'.
create or replace function public.ingest_status(p_status jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_event_id bigint;
begin
  insert into public.message_events (event_type, dedupe_key, wamid, status, event_ts, payload)
  values (
    'status',
    concat_ws(':', 'st', p_status ->> 'id', p_status ->> 'status', p_status ->> 'timestamp'),
    p_status ->> 'id',
    p_status ->> 'status',
    to_timestamp((p_status ->> 'timestamp')::bigint),
    p_status)
  on conflict (dedupe_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return 'duplicate';
  end if;

  if public.apply_status(p_status) then
    update public.message_events set processed_at = now(), process_attempts = 1 where id = v_event_id;
    return 'applied';
  end if;

  update public.message_events set process_attempts = 1 where id = v_event_id;
  return 'pending';
end;
$$;

-- Reprocesa statuses que llegaron antes de que se guardara el wamid del envío.
create or replace function public.reprocess_pending_statuses(p_wamid text default null) returns integer
language plpgsql set search_path = '' as $$
declare
  v_event record;
  v_count integer := 0;
begin
  for v_event in
    select id, payload from public.message_events
    where event_type = 'status' and processed_at is null and process_attempts < 50
      and (p_wamid is null or wamid = p_wamid)
    order by event_ts, id
  loop
    if public.apply_status(v_event.payload) then
      update public.message_events set processed_at = now(), process_attempts = process_attempts + 1
        where id = v_event.id;
      v_count := v_count + 1;
    else
      update public.message_events set process_attempts = process_attempts + 1 where id = v_event.id;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Meta aceptó el envío: guarda wamid y aplica statuses que hayan llegado antes.
create or replace function public.record_send_success(p_message_id uuid, p_wamid text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.messages set
    wamid = p_wamid,
    sent_at = coalesce(sent_at, now()),
    status = case when status in ('sending', 'unknown') then 'sent' else status end,
    locked_at = null,
    error_code = null, error_title = null, error_details = null
  where id = p_message_id;
  perform public.reprocess_pending_statuses(p_wamid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Respuestas entrantes
-- ---------------------------------------------------------------------------

create or replace function public.record_inbound(
  p_wa_message_id text,
  p_from text,
  p_context_wamid text,
  p_type text,
  p_text text,
  p_button_payload text,
  p_received_at timestamptz,
  p_intent text,
  p_raw jsonb
) returns text
language plpgsql set search_path = '' as $$
declare
  v_contact_id uuid;
  v_message_id uuid;
  v_inbound_id uuid;
begin
  insert into public.message_events (event_type, dedupe_key, wamid, status, event_ts, payload, processed_at)
  values ('message', 'in:' || p_wa_message_id, p_wa_message_id, 'received', p_received_at, p_raw, now())
  on conflict (dedupe_key) do nothing;
  if not found then
    return 'duplicate';
  end if;

  select id into v_contact_id from public.contacts where wa_phone = p_from;

  if p_context_wamid is not null then
    select id into v_message_id from public.messages where wamid = p_context_wamid;
  end if;
  if v_message_id is null and v_contact_id is not null then
    select id into v_message_id from public.messages
    where contact_id = v_contact_id and wamid is not null
    order by sent_at desc nulls last limit 1;
  end if;

  insert into public.inbound_messages (
    wa_message_id, contact_id, from_phone, context_wamid, message_id, type, text, button_payload,
    received_at, intent, raw)
  values (
    p_wa_message_id, v_contact_id, p_from, p_context_wamid, v_message_id, p_type, p_text,
    p_button_payload, p_received_at, p_intent, p_raw)
  on conflict (wa_message_id) do nothing
  returning id into v_inbound_id;

  if p_intent = 'opt_out' then
    perform public.register_opt_out(
      p_from,
      case when p_type in ('button', 'interactive') then 'button' else 'keyword' end,
      v_inbound_id,
      p_received_at);
  end if;

  return 'recorded';
end;
$$;

-- ---------------------------------------------------------------------------
-- Estado de plantillas (webhook message_template_status_update / quality_update)
-- ---------------------------------------------------------------------------

create or replace function public.update_template_status(
  p_name text, p_meta_status text, p_reason text default null, p_quality text default null
) returns integer
language plpgsql set search_path = '' as $$
declare
  v_template_id uuid;
  v_status text;
  v_paused integer := 0;
begin
  v_status := case upper(coalesce(p_meta_status, ''))
    when 'APPROVED' then 'approved'
    when 'REJECTED' then 'rejected'
    when 'PAUSED' then 'paused'
    when 'DISABLED' then 'disabled'
    when 'PENDING' then 'pending'
    when 'IN_APPEAL' then 'pending'
    when 'PENDING_DELETION' then 'disabled'
    when 'DELETED' then 'disabled'
    else null
  end;

  update public.templates set
    status = coalesce(v_status, status),
    status_reason = coalesce(p_reason, status_reason),
    quality = coalesce(p_quality, quality)
  where name = p_name
  returning id into v_template_id;

  if v_template_id is not null and v_status in ('paused', 'disabled', 'rejected') then
    update public.campaigns ca set
      status = 'paused',
      pause_error_code = 'template_' || v_status,
      pause_reason = format('Meta marcó la plantilla %s como %s%s', p_name, upper(p_meta_status),
        case when p_reason is not null then ': ' || p_reason else '' end),
      paused_at = now()
    where ca.status in ('sending', 'completed')
      and exists (
        select 1 from public.messages m
        where m.campaign_id = ca.id and m.template_id = v_template_id and m.status = 'queued');
    get diagnostics v_paused = row_count;
  end if;

  return v_paused;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seguimientos
-- ---------------------------------------------------------------------------

-- Evalúa las reglas activas y encola seguimientos. Idempotente.
create or replace function public.enqueue_follow_ups() returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with originals as (
    select m.id as original_id, m.campaign_id, m.contact_id, m.variables,
      m.sent_at as original_sent_at, m.failed_at as original_failed_at
    from public.messages m
    join public.campaigns ca on ca.id = m.campaign_id
    where m.kind = 'campaign' and m.sent_at is not null and ca.status in ('sending', 'completed')
  ),
  chain as (
    select o.*, last.delivered_at, last.read_at, last.failed_at as base_failed_at,
      (select count(*) from public.messages f
        where f.parent_message_id = o.original_id and f.kind = 'follow_up' and f.status <> 'cancelled') as follow_ups,
      exists (select 1 from public.messages f
        where f.parent_message_id = o.original_id and f.kind = 'follow_up'
          and f.status in ('queued', 'sending', 'unknown')) as pending
    from originals o
    cross join lateral (
      -- Último envío de la cadena (original o seguimiento): sobre él se evalúa el disparador.
      select x.delivered_at, x.read_at, x.failed_at
      from public.messages x
      where (x.id = o.original_id or (x.parent_message_id = o.original_id and x.kind = 'follow_up'))
        and x.sent_at is not null
      order by x.sent_at desc
      limit 1
    ) last
  ),
  candidates as (
    select distinct on (ch.original_id)
      ch.original_id, ch.campaign_id, ch.contact_id, ch.variables, r.id as rule_id, r.template_id
    from chain ch
    join public.campaigns ca on ca.id = ch.campaign_id
    join public.follow_up_rules r on r.campaign_id = ch.campaign_id and r.active
    join public.templates t on t.id = r.template_id and t.kind = 'follow_up' and t.status = 'approved'
    join public.contacts c on c.id = ch.contact_id
    where ch.original_failed_at is null
      and ch.base_failed_at is null
      and not ch.pending
      and ch.follow_ups < ca.max_follow_ups
      and c.opted_out_at is null
      and c.send_allowed
      and not exists (select 1 from public.opt_outs oo where oo.wa_phone = c.wa_phone)
      and not exists (
        select 1 from public.inbound_messages i
        where i.contact_id = c.id and i.received_at >= ch.original_sent_at)
      and not exists (
        select 1 from public.messages f
        where f.parent_message_id = ch.original_id and f.follow_up_rule_id = r.id)
      and case r.trigger
        when 'read_no_reply' then
          ch.read_at is not null and ch.read_at <= now() - make_interval(days => r.delay_days)
        when 'delivered_not_read' then
          ch.read_at is null and ch.delivered_at is not null
          and ch.delivered_at <= now() - make_interval(days => r.delay_days)
        else false
      end
    order by ch.original_id, r.step, r.created_at
  )
  insert into public.messages (campaign_id, contact_id, template_id, kind, parent_message_id, follow_up_rule_id, variables)
  select campaign_id, contact_id, template_id, 'follow_up', original_id, rule_id, variables
  from candidates
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vistas del panel (security_invoker: respetan RLS del usuario)
-- ---------------------------------------------------------------------------

create view public.campaign_message_stats with (security_invoker = true) as
select
  campaign_id,
  kind,
  count(*) filter (where status = 'queued') as queued,
  count(*) filter (where status = 'sending') as sending,
  count(*) filter (where sent_at is not null) as sent,
  count(*) filter (where delivered_at is not null or read_at is not null) as delivered,
  count(*) filter (where read_at is not null) as read,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'unknown') as unknown,
  count(*) filter (where status = 'cancelled') as cancelled,
  coalesce(sum(estimated_cost), 0) as estimated_cost
from public.messages
where kind in ('campaign', 'follow_up')
group by campaign_id, kind;

create view public.campaign_reply_stats with (security_invoker = true) as
select
  m.campaign_id,
  count(distinct m.contact_id) as replied,
  count(distinct m.contact_id) filter (where i.intent = 'interested') as interested,
  count(distinct m.contact_id) filter (where i.intent = 'opt_out') as opted_out
from public.inbound_messages i
join public.messages m on m.id = i.message_id
where m.campaign_id is not null
group by m.campaign_id;

create view public.campaign_contact_rows with (security_invoker = true) as
select
  m.id as message_id,
  m.campaign_id,
  c.id as contact_id,
  c.contact_name,
  c.company,
  c.rubro,
  c.zona,
  c.wa_phone,
  t.name as template_name,
  m.status,
  m.queued_at,
  m.sent_at,
  m.delivered_at,
  m.read_at,
  m.failed_at,
  m.error_code,
  m.error_title,
  m.error_details,
  m.estimated_cost + coalesce(f.follow_up_cost, 0) as estimated_cost,
  coalesce(f.follow_ups, 0) as follow_ups,
  f.last_follow_up_status,
  lr.text as last_reply_text,
  lr.intent as last_reply_intent,
  lr.received_at as last_reply_at,
  (lr.received_at is not null) as replied,
  coalesce(ir.interested, false) as interested,
  (c.opted_out_at is not null) as opted_out
from public.messages m
join public.contacts c on c.id = m.contact_id
join public.templates t on t.id = m.template_id
left join lateral (
  select count(*) as follow_ups,
    sum(x.estimated_cost) as follow_up_cost,
    (array_agg(x.status order by x.queued_at desc))[1] as last_follow_up_status
  from public.messages x
  where x.parent_message_id = m.id and x.kind = 'follow_up' and x.status <> 'cancelled'
) f on true
left join lateral (
  select i.text, i.intent, i.received_at
  from public.inbound_messages i
  join public.messages mm on mm.id = i.message_id
  where mm.campaign_id = m.campaign_id and mm.contact_id = m.contact_id
  order by i.received_at desc
  limit 1
) lr on true
left join lateral (
  select true as interested
  from public.inbound_messages i
  join public.messages mm on mm.id = i.message_id
  where mm.campaign_id = m.campaign_id and mm.contact_id = m.contact_id and i.intent = 'interested'
  limit 1
) ir on true
where m.kind = 'campaign';

-- ---------------------------------------------------------------------------
-- Operaciones del despachador (las llama /api/cron/dispatch con la service role)
-- ---------------------------------------------------------------------------

create or replace function public.is_opted_out(p_phone text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.opt_outs where wa_phone = p_phone)
      or exists (select 1 from public.contacts where wa_phone = p_phone and opted_out_at is not null);
$$;

create or replace function public.cancel_message(p_message_id uuid) returns void
language sql set search_path = '' as $$
  update public.messages set status = 'cancelled', locked_at = null where id = p_message_id;
$$;

-- Vuelve a la cola sin contar el intento.
create or replace function public.release_messages(
  p_message_ids uuid[], p_error_code text default null, p_error_title text default null,
  p_error_details text default null
) returns void
language sql set search_path = '' as $$
  update public.messages set
    status = 'queued',
    locked_at = null,
    attempts = greatest(attempts - 1, 0),
    error_code = coalesce(p_error_code, error_code),
    error_title = coalesce(p_error_title, error_title),
    error_details = coalesce(p_error_details, error_details)
  where id = any (p_message_ids) and status = 'sending';
$$;

create or replace function public.retry_message(
  p_message_id uuid, p_retry_at timestamptz, p_error_code text, p_error_title text, p_error_details text
) returns void
language sql set search_path = '' as $$
  update public.messages set
    status = 'queued', locked_at = null, next_attempt_at = p_retry_at,
    error_code = p_error_code, error_title = p_error_title, error_details = p_error_details
  where id = p_message_id and status = 'sending';
$$;

create or replace function public.fail_message(
  p_message_id uuid, p_error_code text, p_error_title text, p_error_details text
) returns void
language sql set search_path = '' as $$
  update public.messages set
    status = 'failed', locked_at = null, failed_at = now(),
    error_code = p_error_code, error_title = p_error_title, error_details = p_error_details
  where id = p_message_id and status = 'sending';
$$;

create or replace function public.pause_campaign(p_campaign_id uuid, p_code text, p_reason text) returns void
language sql set search_path = '' as $$
  update public.campaigns set
    status = 'paused', pause_error_code = p_code, pause_reason = p_reason, paused_at = now()
  where id = p_campaign_id and status in ('sending', 'completed');
$$;

create or replace function public.resume_campaign(p_campaign_id uuid) returns void
language sql set search_path = '' as $$
  update public.campaigns set
    status = case
      when exists (
        select 1 from public.messages m
        where m.campaign_id = p_campaign_id and m.kind = 'campaign' and m.status in ('queued', 'sending'))
      then 'sending' else 'completed' end,
    pause_error_code = null, pause_reason = null, paused_at = null
  where id = p_campaign_id and status = 'paused';
$$;

create or replace function public.halt_sending(p_reason text) returns void
language sql set search_path = '' as $$
  update public.app_settings set sending_halted = true, halt_reason = p_reason, halted_at = now();
$$;

create or replace function public.mark_template(p_name text, p_status text, p_reason text) returns void
language sql set search_path = '' as $$
  update public.templates set status = p_status, status_reason = p_reason where name = p_name;
$$;

-- Evento de webhook que no se pudo procesar: queda para revisión/reproceso.
create or replace function public.record_webhook_error(p_payload jsonb, p_error text) returns void
language sql set search_path = '' as $$
  insert into public.message_events (event_type, payload, processing_error)
  values ('other', p_payload, p_error);
$$;

create or replace function public.record_webhook_other(p_payload jsonb) returns void
language sql set search_path = '' as $$
  insert into public.message_events (event_type, payload, processed_at)
  values (case when p_payload ->> 'field' like 'message_template%' then 'template' else 'other' end, p_payload, now());
$$;
