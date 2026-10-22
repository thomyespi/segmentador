-- Gen12 · Índices para claves foráneas (advisor unindexed_foreign_keys).

create index if not exists contacts_last_import_idx on public.contacts (last_import_id);
create index if not exists follow_up_rules_template_idx on public.follow_up_rules (template_id);
create index if not exists messages_follow_up_rule_idx on public.messages (follow_up_rule_id);
create index if not exists messages_template_idx on public.messages (template_id);
create index if not exists opt_outs_contact_idx on public.opt_outs (contact_id);
create index if not exists opt_outs_inbound_message_idx on public.opt_outs (inbound_message_id);
