import { contactRowsQuery, parseContactRowFilters, type ContactRow } from "@/lib/contact-rows";
import { toCsv } from "@/lib/csv";
import { INTENT, MESSAGE_STATUS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const HEADERS = [
  "Empresa", "Contacto", "WhatsApp", "Rubro", "Zona", "Plantilla", "Estado", "Encolado", "Enviado", "Entregado",
  "Leído", "Fallido", "Código de error", "Error", "Seguimientos", "Estado último seguimiento", "Respondió",
  "Me interesa", "Baja", "Última respuesta", "Tipo de respuesta", "Fecha última respuesta", "Costo estimado (USD)",
];

/** CSV de la tabla por contacto con los mismos filtros de la pantalla. */
export async function GET(request: Request, ctx: RouteContext<"/campanas/[id]/export">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Unauthorized", { status: 401 });

  const filters = parseContactRowFilters(Object.fromEntries(new URL(request.url).searchParams));
  const rows: ContactRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await contactRowsQuery(supabase, id, filters).range(from, from + 999);
    if (error) return new Response(error.message, { status: 500 });
    rows.push(...(data as ContactRow[]));
    if (data.length < 1000) break;
  }

  const csv = toCsv(
    HEADERS,
    rows.map((r) => [
      r.company, r.contact_name, r.wa_phone, r.rubro, r.zona, r.template_name, MESSAGE_STATUS[r.status] ?? r.status,
      r.queued_at, r.sent_at, r.delivered_at, r.read_at, r.failed_at, r.error_code, r.error_details ?? r.error_title,
      r.follow_ups, r.last_follow_up_status ? MESSAGE_STATUS[r.last_follow_up_status] : "", r.replied ? "SI" : "NO",
      r.interested ? "SI" : "NO", r.opted_out ? "SI" : "NO", r.last_reply_text,
      r.last_reply_intent ? INTENT[r.last_reply_intent] : "", r.last_reply_at, r.estimated_cost,
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campana-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
