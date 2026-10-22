"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAudience } from "@/lib/campaign-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw new Error("Identificador inválido");
  return id;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length <= 200).slice(0, 100);
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function previewAudience(rubros: string[], zonas: string[]) {
  const { supabase } = await requireUser();
  return getAudience(supabase, stringList(rubros), stringList(zonas), 10);
}

export type CreateCampaignState = { error?: string } | null;

export async function createCampaign(_prev: CreateCampaignState, formData: FormData): Promise<CreateCampaignState> {
  const { supabase } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const rubros = stringList(formData.getAll("rubro"));
  const zonas = stringList(formData.getAll("zona"));
  const maxFollowUps = Math.min(5, Math.max(0, Number(formData.get("max_follow_ups") ?? 1) || 0));

  if (!name) return { error: "Poné un nombre a la campaña." };
  if (rubros.length === 0 && zonas.length === 0) return { error: "Elegí al menos un rubro o una zona." };

  const { data, error } = await supabase
    .from("campaigns")
    .insert({ name, max_follow_ups: maxFollowUps })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const filters = [
    ...rubros.map((value) => ({ campaign_id: data.id, field: "rubro", value })),
    ...zonas.map((value) => ({ campaign_id: data.id, field: "zona", value })),
  ];
  const inserted = await supabase.from("campaign_filters").insert(filters);
  if (inserted.error) return { error: inserted.error.message };

  redirect(`/campanas/${data.id}`);
}

export async function confirmCampaign(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("campaign_id"));
  const { error } = await supabase.rpc("enqueue_campaign", { p_campaign_id: id });
  check(error);
  revalidatePath(`/campanas/${id}`);
}

export async function pauseCampaign(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("campaign_id"));
  const { error } = await supabase.rpc("pause_campaign", {
    p_campaign_id: id, p_code: "manual", p_reason: "Pausada manualmente desde el panel",
  });
  check(error);
  revalidatePath(`/campanas/${id}`);
}

export async function resumeCampaign(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("campaign_id"));
  const { error } = await supabase.rpc("resume_campaign", { p_campaign_id: id });
  check(error);
  revalidatePath(`/campanas/${id}`);
}

export async function cancelCampaign(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("campaign_id"));
  const { error } = await supabase.rpc("cancel_campaign", { p_campaign_id: id });
  check(error);
  revalidatePath(`/campanas/${id}`);
}

export async function updateMaxFollowUps(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("campaign_id"));
  const max = Math.min(5, Math.max(0, Number(formData.get("max_follow_ups")) || 0));
  const { error } = await supabase.from("campaigns").update({ max_follow_ups: max }).eq("id", id);
  check(error);
  revalidatePath(`/campanas/${id}`);
}

export async function addFollowUpRule(formData: FormData) {
  const { supabase } = await requireUser();
  const campaignId = uuid(formData.get("campaign_id"));
  const templateId = uuid(formData.get("template_id"));
  const trigger = String(formData.get("trigger"));
  const delayDays = Math.round(Number(formData.get("delay_days")));
  if (trigger !== "read_no_reply" && trigger !== "delivered_not_read") throw new Error("Disparador inválido");
  if (!(delayDays >= 1 && delayDays <= 60)) throw new Error("Los días tienen que estar entre 1 y 60");

  // Solo plantillas de seguimiento aprobadas: se mandan fuera de la ventana de 24 h.
  const { data: template, error: tErr } = await supabase
    .from("templates").select("kind, status").eq("id", templateId).single();
  check(tErr);
  if (template?.kind !== "follow_up" || template.status !== "approved") {
    throw new Error("La plantilla tiene que ser de seguimiento y estar aprobada en Meta");
  }

  const { data: last } = await supabase
    .from("follow_up_rules").select("step").eq("campaign_id", campaignId)
    .order("step", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("follow_up_rules").insert({
    campaign_id: campaignId, template_id: templateId, trigger, delay_days: delayDays, step: (last?.step ?? 0) + 1,
  });
  check(error);
  revalidatePath(`/campanas/${campaignId}`);
}

export async function toggleFollowUpRule(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("rule_id"));
  const campaignId = uuid(formData.get("campaign_id"));
  const active = formData.get("active") === "true";
  const { error } = await supabase.from("follow_up_rules").update({ active }).eq("id", id);
  check(error);
  revalidatePath(`/campanas/${campaignId}`);
}

export async function deleteFollowUpRule(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("rule_id"));
  const campaignId = uuid(formData.get("campaign_id"));
  const { error } = await supabase.from("follow_up_rules").delete().eq("id", id);
  check(error);
  revalidatePath(`/campanas/${campaignId}`);
}

export async function runFollowUpsNow(formData: FormData) {
  const { supabase } = await requireUser();
  const campaignId = uuid(formData.get("campaign_id"));
  const { error } = await supabase.rpc("enqueue_follow_ups");
  check(error);
  revalidatePath(`/campanas/${campaignId}`);
}

/** Envío "incierto": tras revisarlo en WhatsApp Manager, se marca como enviado o se devuelve a la cola. */
export async function resolveUnknownMessage(formData: FormData) {
  const { supabase } = await requireUser();
  const id = uuid(formData.get("message_id"));
  const campaignId = uuid(formData.get("campaign_id"));
  const outcome = formData.get("outcome");
  const update =
    outcome === "sent"
      ? { status: "sent", sent_at: new Date().toISOString(), locked_at: null }
      : outcome === "requeue"
        ? { status: "queued", next_attempt_at: new Date().toISOString(), locked_at: null }
        : null;
  if (!update) throw new Error("Opción inválida");
  const { error } = await supabase.from("messages").update(update).eq("id", id).eq("status", "unknown");
  check(error);
  revalidatePath(`/campanas/${campaignId}`);
}
