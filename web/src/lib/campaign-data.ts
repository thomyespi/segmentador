import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MessageStats = {
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  unknown: number;
  cancelled: number;
  estimated_cost: number;
};

export type CampaignStats = {
  original: MessageStats;
  followUp: MessageStats;
  total: MessageStats;
  replied: number;
  interested: number;
  optedOut: number;
};

const EMPTY: MessageStats = {
  queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0, unknown: 0, cancelled: 0, estimated_cost: 0,
};

function toStats(row: Record<string, unknown> | undefined): MessageStats {
  if (!row) return { ...EMPTY };
  return Object.fromEntries(Object.keys(EMPTY).map((k) => [k, Number(row[k] ?? 0)])) as MessageStats;
}

function sum(a: MessageStats, b: MessageStats): MessageStats {
  return Object.fromEntries(
    Object.keys(EMPTY).map((k) => [k, a[k as keyof MessageStats] + b[k as keyof MessageStats]]),
  ) as MessageStats;
}

export async function getCampaignStats(supabase: SupabaseClient, campaignIds: string[]) {
  const result = new Map<string, CampaignStats>();
  if (campaignIds.length === 0) return result;

  const [messages, replies] = await Promise.all([
    supabase.from("campaign_message_stats").select("*").in("campaign_id", campaignIds),
    supabase.from("campaign_reply_stats").select("*").in("campaign_id", campaignIds),
  ]);
  if (messages.error) throw new Error(messages.error.message);
  if (replies.error) throw new Error(replies.error.message);

  for (const id of campaignIds) {
    const original = toStats(messages.data.find((r) => r.campaign_id === id && r.kind === "campaign"));
    const followUp = toStats(messages.data.find((r) => r.campaign_id === id && r.kind === "follow_up"));
    const reply = replies.data.find((r) => r.campaign_id === id);
    result.set(id, {
      original,
      followUp,
      total: sum(original, followUp),
      replied: Number(reply?.replied ?? 0),
      interested: Number(reply?.interested ?? 0),
      optedOut: Number(reply?.opted_out ?? 0),
    });
  }
  return result;
}

export type SendingState = {
  dailyCap: number;
  used: number;
  halted: boolean;
  haltReason: string | null;
  haltedAt: string | null;
  windowStart: string;
  windowEnd: string;
  marketingRate: number;
  batchSize: number;
};

export async function getSendingState(supabase: SupabaseClient): Promise<SendingState> {
  const [settings, used] = await Promise.all([
    supabase.from("app_settings").select("*").single(),
    supabase.rpc("recipients_last_24h"),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  if (used.error) throw new Error(used.error.message);
  const s = settings.data;
  return {
    dailyCap: s.daily_cap,
    used: Number(used.data ?? 0),
    halted: s.sending_halted,
    haltReason: s.halt_reason,
    haltedAt: s.halted_at,
    windowStart: String(s.send_window_start).slice(0, 5),
    windowEnd: String(s.send_window_end).slice(0, 5),
    marketingRate: Number(s.marketing_rate_usd),
    batchSize: s.batch_size,
  };
}

export async function getCampaignFilters(supabase: SupabaseClient, campaignId: string) {
  const { data, error } = await supabase.from("campaign_filters").select("field, value").eq("campaign_id", campaignId);
  if (error) throw new Error(error.message);
  return {
    rubros: data.filter((f) => f.field === "rubro").map((f) => f.value as string),
    zonas: data.filter((f) => f.field === "zona").map((f) => f.value as string),
  };
}

export type AudienceCount = { exclusion: string | null; total: number };

export async function getAudience(supabase: SupabaseClient, rubros: string[], zonas: string[], previewLimit = 10) {
  const [counts, preview] = await Promise.all([
    supabase.rpc("campaign_audience_counts", { p_rubros: rubros, p_zonas: zonas }),
    supabase.rpc("campaign_preview", { p_rubros: rubros, p_zonas: zonas, p_limit: previewLimit, p_offset: 0 }),
  ]);
  if (counts.error) throw new Error(counts.error.message);
  if (preview.error) throw new Error(preview.error.message);
  const rows = (counts.data as AudienceCount[]).map((c) => ({ exclusion: c.exclusion, total: Number(c.total) }));
  return {
    eligible: rows.find((c) => c.exclusion === null)?.total ?? 0,
    excluded: rows.filter((c) => c.exclusion !== null).sort((a, b) => b.total - a.total),
    preview: preview.data as AudiencePreview[],
  };
}

export type AudiencePreview = {
  contact_id: string;
  wa_phone: string;
  contact_name: string | null;
  company: string | null;
  rubro: string | null;
  zona: string | null;
  var_1: string;
  var_2: string;
  template_name: string;
  body: string;
  footer: string | null;
  buttons: { type: string; text: string }[];
};
