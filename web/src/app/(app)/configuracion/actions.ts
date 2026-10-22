"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEMPLATE_STATUSES = new Set(["approved", "pending", "rejected", "paused", "disabled"]);

export async function updateSettings(formData: FormData) {
  const { supabase } = await requireUser();
  const dailyCap = Math.round(Number(formData.get("daily_cap")));
  const batchSize = Math.round(Number(formData.get("batch_size")));
  const rate = Number(String(formData.get("marketing_rate_usd")).replace(",", "."));
  const start = String(formData.get("send_window_start"));
  const end = String(formData.get("send_window_end"));

  if (!(dailyCap >= 0 && dailyCap <= 100000)) throw new Error("Tope diario inválido");
  if (!(batchSize >= 1 && batchSize <= 200)) throw new Error("El lote tiene que estar entre 1 y 200");
  if (!(rate >= 0 && rate < 10)) throw new Error("Tarifa inválida");
  if (!TIME.test(start) || !TIME.test(end) || start >= end) throw new Error("Ventana horaria inválida");

  const { error } = await supabase
    .from("app_settings")
    .update({
      daily_cap: dailyCap,
      batch_size: batchSize,
      marketing_rate_usd: rate,
      send_window_start: start,
      send_window_end: end,
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/configuracion");
}

export async function resumeSending() {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("app_settings")
    .update({ sending_halted: false, halt_reason: null, halted_at: null })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

/** Estado de una plantilla según WhatsApp Manager (también lo actualiza el webhook). */
export async function setTemplateStatus(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("template_id"));
  const status = String(formData.get("status"));
  if (!TEMPLATE_STATUSES.has(status)) throw new Error("Estado inválido");
  const { error } = await supabase.from("templates").update({ status, status_reason: "Cambiado a mano en el panel" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/configuracion");
}
