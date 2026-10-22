import { expect, test } from "vitest";
import { createTestDb } from "./helpers/db";
import { insertContact } from "./helpers/fixtures";

const TABLES = [
  "app_settings", "imports", "contacts", "templates", "campaigns", "campaign_filters",
  "follow_up_rules", "messages", "message_events", "inbound_messages", "opt_outs",
];

test("RLS habilitado en todas las tablas", async () => {
  const db = await createTestDb();
  const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
  );
  expect(r.rows.map((t) => t.relname).sort()).toEqual([...TABLES].sort());
  expect(r.rows.every((t) => t.relrowsecurity)).toBe(true);
});

test("anon no lee ni escribe; authenticated tiene acceso total", async () => {
  const db = await createTestDb();
  await insertContact(db);

  await db.exec(`set role anon`);
  for (const table of TABLES) {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
    expect(r.rows[0].n, table).toBe(0);
  }
  await expect(db.query(`insert into public.campaigns (name) values ('x')`)).rejects.toThrow(/row-level security/);
  await expect(db.query(`select * from public.campaign_candidates(null, null)`)).rejects.toThrow(/permission denied/);

  await db.exec(`reset role; set role authenticated`);
  expect((await db.query<{ n: number }>(`select count(*)::int as n from public.contacts`)).rows[0].n).toBe(1);
  await db.query(`insert into public.campaigns (name) values ('x')`);
  await expect(db.query(`select * from public.claim_messages(1)`)).rejects.toThrow(/permission denied/);
  await db.exec(`reset role`);
});
