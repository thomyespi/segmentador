import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ContactRowFilters = {
  status?: string;
  rubro?: string;
  zona?: string;
  replied?: "si" | "no";
  interested?: "si";
  optedOut?: "si" | "no";
  q?: string;
};

const STATUSES = new Set(["queued", "sending", "sent", "delivered", "read", "failed", "cancelled", "unknown"]);

export function parseContactRowFilters(params: Record<string, string | string[] | undefined>): ContactRowFilters {
  const get = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const yesNo = (k: string) => {
    const v = get(k);
    return v === "si" || v === "no" ? v : undefined;
  };
  const status = get("estado");
  return {
    status: status && STATUSES.has(status) ? status : undefined,
    rubro: get("rubro"),
    zona: get("zona"),
    replied: yesNo("respondio"),
    interested: get("interesa") === "si" ? "si" : undefined,
    optedOut: yesNo("baja"),
    // Fuera los caracteres con significado en los filtros de PostgREST.
    q: get("q")?.replace(/[,()*%\\]/g, " ").trim().slice(0, 80) || undefined,
  };
}

export function filtersToSearchParams(filters: ContactRowFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set("estado", filters.status);
  if (filters.rubro) params.set("rubro", filters.rubro);
  if (filters.zona) params.set("zona", filters.zona);
  if (filters.replied) params.set("respondio", filters.replied);
  if (filters.interested) params.set("interesa", filters.interested);
  if (filters.optedOut) params.set("baja", filters.optedOut);
  if (filters.q) params.set("q", filters.q);
  return params;
}

export type ContactRow = {
  message_id: string;
  contact_id: string;
  contact_name: string | null;
  company: string | null;
  rubro: string | null;
  zona: string | null;
  wa_phone: string;
  template_name: string;
  status: string;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_title: string | null;
  error_details: string | null;
  estimated_cost: number;
  follow_ups: number;
  last_follow_up_status: string | null;
  last_reply_text: string | null;
  last_reply_intent: string | null;
  last_reply_at: string | null;
  replied: boolean;
  interested: boolean;
  opted_out: boolean;
};

export function contactRowsQuery(
  supabase: SupabaseClient,
  campaignId: string,
  filters: ContactRowFilters,
  options: { count?: boolean } = {},
) {
  let query = supabase
    .from("campaign_contact_rows")
    .select("*", options.count ? { count: "exact" } : undefined)
    .eq("campaign_id", campaignId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.rubro) query = query.eq("rubro", filters.rubro);
  if (filters.zona) query = query.eq("zona", filters.zona);
  if (filters.replied) query = query.eq("replied", filters.replied === "si");
  if (filters.interested) query = query.eq("interested", true);
  if (filters.optedOut) query = query.eq("opted_out", filters.optedOut === "si");
  if (filters.q) {
    const like = `%${filters.q}%`;
    query = query.or(`contact_name.ilike.${like},company.ilike.${like},wa_phone.ilike.${like}`);
  }
  return query.order("company", { ascending: true, nullsFirst: false }).order("message_id");
}
