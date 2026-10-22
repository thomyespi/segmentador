import { toCsv } from "@/lib/csv";
import type { RejectedRow } from "@/lib/import/contacts";
import { createClient } from "@/lib/supabase/server";

/** Filas inválidas y duplicadas de una importación. */
export async function GET(_request: Request, ctx: RouteContext<"/importar/[id]/detalle">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase.from("imports").select("report").eq("id", id).maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return new Response("Not found", { status: 404 });

  const report = (data.report ?? {}) as { invalid?: RejectedRow[]; duplicates?: RejectedRow[] };
  const csv = toCsv(["Tipo", "ID", "WhatsApp", "Motivo", "ID conservado"], [
    ...(report.invalid ?? []).map((r) => ["Inválido", r.excel_id, r.whatsapp, r.reason, ""]),
    ...(report.duplicates ?? []).map((r) => ["Duplicado", r.excel_id, r.whatsapp, r.reason, r.kept_excel_id ?? ""]),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="importacion-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
