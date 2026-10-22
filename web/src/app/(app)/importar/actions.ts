"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { ContactImportRow, RejectedRow } from "@/lib/import/contacts";
import { normalizeWaPhone } from "@/lib/phone";

const MAX_BATCH = 1000;
const UUID = /^[0-9a-f-]{36}$/i;

export async function startImport(input: {
  fileName: string;
  rowsRead: number;
  invalid: RejectedRow[];
  duplicates: RejectedRow[];
}): Promise<string> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("imports")
    .insert({
      file_name: String(input.fileName).slice(0, 200),
      kind: "contacts",
      rows_read: Number(input.rowsRead) || 0,
      invalid: input.invalid.length,
      duplicates: input.duplicates.length,
      report: { invalid: input.invalid.slice(0, 5000), duplicates: input.duplicates.slice(0, 5000) },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function importBatch(importId: string, rows: ContactImportRow[]) {
  const { supabase } = await requireUser();
  if (!UUID.test(importId)) throw new Error("Importación inválida");
  if (!Array.isArray(rows) || rows.length > MAX_BATCH) throw new Error("Tanda inválida");
  // Revalidamos en el servidor lo que viene del navegador.
  const clean = rows.filter((r) => normalizeWaPhone(r.wa_phone) === r.wa_phone);
  const { data, error } = await supabase.rpc("import_contacts", { p_import_id: importId, p_rows: clean });
  if (error) throw new Error(error.message);
  return data as { inserted: number; updated: number; legacy_sends: number };
}

export async function finishImport(importId: string) {
  const { supabase } = await requireUser();
  if (!UUID.test(importId)) throw new Error("Importación inválida");
  const { data, error } = await supabase
    .from("imports")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", importId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/importar");
  return data as { inserted: number; updated: number; duplicates: number; invalid: number; legacy_sends: number };
}

export async function importOptOuts(fileName: string, phones: string[], invalid: string[]) {
  const { supabase } = await requireUser();
  const clean = phones.map((p) => normalizeWaPhone(p)).filter((p): p is string => p !== null);
  const { data, error } = await supabase.rpc("import_opt_outs", { p_phones: clean });
  if (error) throw new Error(error.message);
  await supabase.from("imports").insert({
    file_name: String(fileName).slice(0, 200),
    kind: "opt_outs",
    rows_read: phones.length + invalid.length,
    inserted: Number(data),
    invalid: invalid.length,
    report: { invalid: invalid.slice(0, 1000) },
    finished_at: new Date().toISOString(),
  });
  revalidatePath("/importar");
  return Number(data);
}

export async function importLegacySends(fileName: string, rows: { wa_phone: string; template_name: string }[]) {
  const { supabase } = await requireUser();
  const clean = rows
    .filter((r) => normalizeWaPhone(r.wa_phone) === r.wa_phone && typeof r.template_name === "string")
    .slice(0, 20000);
  const { data, error } = await supabase.rpc("import_legacy_sends", { p_rows: clean });
  if (error) throw new Error(error.message);
  await supabase.from("imports").insert({
    file_name: String(fileName).slice(0, 200),
    kind: "send_log",
    rows_read: rows.length,
    legacy_sends: Number(data),
    finished_at: new Date().toISOString(),
  });
  revalidatePath("/importar");
  return Number(data);
}
