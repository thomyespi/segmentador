import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/** Exige sesión. Usar en cada página y Server Action, no solo en el proxy. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
}
