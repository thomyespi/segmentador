-- Gen12 · Campañas de WhatsApp: esquema base.
-- Ver openspec/changes/add-whatsapp-campaigns/design.md (sección "Modelo de datos").

create table public.app_settings (
  id boolean primary key default true check (id),
  daily_cap integer not null default 200 check (daily_cap >= 0),
  batch_size integer not null default 50 check (batch_size between 1 and 200),
  send_window_start time not null default '09:00',
  send_window_end time not null default '20:00',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  marketing_rate_usd numeric(10, 4) not null default 0,
  sending_halted boolean not null default false,
  halt_reason text,
  halted_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.app_settings default values;

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  kind text not null default 'contacts' check (kind in ('contacts', 'opt_outs', 'send_log')),
  rows_read integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  duplicates integer not null default 0,
  invalid integer not null default 0,
  legacy_sends integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  imported_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  wa_phone text not null unique check (wa_phone ~ '^549[0-9]{10}$'),
  excel_id text,
  contact_name text,
  company text,
  rubro text,
  rubro_source text,
  zona text,
  zona_source text,
  var_1 text,
  var_2 text,
  template_name text,
  send_allowed boolean not null default true,
  exclusion_reason text,
  original jsonb not null default '{}'::jsonb,
  opted_out_at timestamptz,
  last_import_id uuid references public.imports (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_rubro_idx on public.contacts (rubro);
create index contacts_zona_idx on public.contacts (zona);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('campaign', 'follow_up')),
  rubro text,
  language text not null default 'es_AR',
  category text not null default 'MARKETING',
  body text not null,
  footer text,
  buttons jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('approved', 'pending', 'rejected', 'paused', 'disabled')),
  status_reason text,
  quality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index templates_campaign_rubro_idx on public.templates (rubro) where kind = 'campaign';

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'paused', 'completed', 'cancelled')),
  pause_reason text,
  pause_error_code text,
  paused_at timestamptz,
  max_follow_ups integer not null default 1 check (max_follow_ups between 0 and 5),
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_filters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  field text not null check (field in ('rubro', 'zona')),
  value text not null,
  unique (campaign_id, field, value)
);

create table public.follow_up_rules (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  step integer not null default 1 check (step >= 1),
  trigger text not null check (trigger in ('read_no_reply', 'delivered_not_read')),
  delay_days integer not null check (delay_days between 1 and 60),
  template_id uuid not null references public.templates (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index follow_up_rules_campaign_idx on public.follow_up_rules (campaign_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  template_id uuid not null references public.templates (id),
  kind text not null check (kind in ('campaign', 'follow_up', 'legacy')),
  parent_message_id uuid references public.messages (id) on delete cascade,
  follow_up_rule_id uuid references public.follow_up_rules (id) on delete set null,
  variables jsonb not null default '[]'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'unknown')),
  wamid text unique,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_title text,
  error_details text,
  pricing jsonb,
  billable boolean,
  pricing_category text,
  estimated_cost numeric(10, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'legacy' or campaign_id is not null),
  check (kind <> 'follow_up' or (parent_message_id is not null and follow_up_rule_id is not null))
);

-- Nunca la misma plantilla de campaña dos veces al mismo número (entre todas las campañas).
create unique index messages_template_once_idx on public.messages (contact_id, template_id)
  where kind in ('campaign', 'legacy') and status <> 'cancelled';
-- Un seguimiento por regla y por mensaje original.
create unique index messages_follow_up_once_idx on public.messages (parent_message_id, follow_up_rule_id)
  where kind = 'follow_up';
create index messages_queue_idx on public.messages (next_attempt_at, queued_at) where status = 'queued';
create index messages_campaign_idx on public.messages (campaign_id);
create index messages_contact_idx on public.messages (contact_id);
create index messages_sent_at_idx on public.messages (sent_at);

create table public.message_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_type text not null check (event_type in ('status', 'message', 'template', 'other')),
  dedupe_key text unique,
  wamid text,
  status text,
  event_ts timestamptz,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  process_attempts integer not null default 0
);

create index message_events_pending_idx on public.message_events (wamid) where processed_at is null;

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text not null unique,
  contact_id uuid references public.contacts (id) on delete set null,
  from_phone text not null,
  context_wamid text,
  message_id uuid references public.messages (id) on delete set null,
  type text not null,
  text text,
  button_payload text,
  received_at timestamptz not null,
  intent text not null default 'other' check (intent in ('interested', 'opt_out', 'other')),
  raw jsonb,
  created_at timestamptz not null default now()
);

create index inbound_messages_contact_idx on public.inbound_messages (contact_id, received_at);
create index inbound_messages_message_idx on public.inbound_messages (message_id);

create table public.opt_outs (
  id uuid primary key default gen_random_uuid(),
  wa_phone text not null unique,
  contact_id uuid references public.contacts (id) on delete set null,
  source text not null check (source in ('button', 'keyword', 'manual', 'legacy_file')),
  inbound_message_id uuid references public.inbound_messages (id) on delete set null,
  created_at timestamptz not null default now()
);

-- updated_at automático
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();
create trigger templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();
create trigger follow_up_rules_touch before update on public.follow_up_rules
  for each row execute function public.touch_updated_at();
create trigger messages_touch before update on public.messages
  for each row execute function public.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();
