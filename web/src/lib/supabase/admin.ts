import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/** Service role: solo para el webhook y los jobs (no tienen sesión). Nunca llega al cliente. */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
