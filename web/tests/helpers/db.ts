import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "supabase", "migrations");

// Lo mínimo de Supabase que usan las migraciones: roles y auth.uid().
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

// pg_cron / pg_net / Vault no existen en PGlite: esa migración se valida en Supabase.
const SKIPPED = ["_cron.sql"];

async function buildTemplateDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !SKIPPED.some((s) => f.endsWith(s)))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
    grant usage, select on all sequences in schema public to anon, authenticated, service_role;
    -- Envíos a toda hora en los tests.
    update public.app_settings set send_window_start = '00:00', send_window_end = '23:59:59.999999';
  `);
  return db;
}

let template: Promise<PGlite> | undefined;

/** Base nueva por test: se migra una vez por archivo y se clona. */
export async function createTestDb(): Promise<PGlite> {
  template ??= buildTemplateDb();
  return (await (await template).clone()) as PGlite;
}
