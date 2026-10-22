import type { PGlite } from "@electric-sql/pglite";
import type { Rpc } from "@/lib/rpc";

/** Misma semántica que supabase.rpc(): tabla → filas; escalar → valor. */
export function pgliteRpc(db: PGlite): Rpc {
  return async <T>(fn: string, args: Record<string, unknown> = {}) => {
    const keys = Object.keys(args);
    const params = keys.map((k) => {
      const v = args[k];
      if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
      return v;
    });
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
    const result = await db.query<Record<string, unknown>>(`select * from public.${fn}(${named})`, params);
    if (result.fields.length === 1 && result.fields[0].name === fn) {
      return (result.rows[0]?.[fn] ?? null) as T;
    }
    return result.rows as T;
  };
}

let phoneSeq = 0;

export function nextPhone(): string {
  phoneSeq++;
  return `549299${String(1000000 + phoneSeq).slice(-7)}`;
}

export type ContactInput = {
  wa_phone?: string;
  rubro?: string;
  zona?: string;
  var_1?: string | null;
  var_2?: string | null;
  template_name?: string | null;
  send_allowed?: boolean;
};

export async function insertContact(db: PGlite, input: ContactInput = {}): Promise<{ id: string; wa_phone: string }> {
  const phone = input.wa_phone ?? nextPhone();
  const r = await db.query<{ id: string; wa_phone: string }>(
    `insert into public.contacts (wa_phone, rubro, zona, var_1, var_2, template_name, send_allowed, contact_name, company)
     values ($1, $2, $3, $4, $5, $6, $7, $4, $5) returning id, wa_phone`,
    [
      phone,
      input.rubro ?? "Energía, oil & gas y minería",
      input.zona ?? "Neuquén",
      input.var_1 === undefined ? "Octavio" : input.var_1,
      input.var_2 === undefined ? "369 Seguridad y Energía" : input.var_2,
      input.template_name === undefined ? "gen12_energia" : input.template_name,
      input.send_allowed ?? true,
    ],
  );
  return r.rows[0];
}

export async function createCampaign(
  db: PGlite,
  filters: { rubros?: string[]; zonas?: string[]; maxFollowUps?: number } = {},
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.campaigns (name, max_follow_ups) values ('Test', $1) returning id`,
    [filters.maxFollowUps ?? 1],
  );
  const id = r.rows[0].id;
  for (const value of filters.rubros ?? []) {
    await db.query(`insert into public.campaign_filters (campaign_id, field, value) values ($1, 'rubro', $2)`, [id, value]);
  }
  for (const value of filters.zonas ?? []) {
    await db.query(`insert into public.campaign_filters (campaign_id, field, value) values ($1, 'zona', $2)`, [id, value]);
  }
  return id;
}

export async function messagesOf(db: PGlite, contactId: string) {
  const r = await db.query<Record<string, unknown>>(
    `select m.*, t.name as template_name from public.messages m join public.templates t on t.id = m.template_id
     where contact_id = $1 order by queued_at, id`,
    [contactId],
  );
  return r.rows;
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
