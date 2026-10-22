import type { SupabaseClient } from "@supabase/supabase-js";

/** Llamada a una función SQL. Misma interfaz para Supabase (producción) y PGlite (tests). */
export type Rpc = <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export function supabaseRpc(client: SupabaseClient): Rpc {
  return async <T>(fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args ?? {});
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
}
