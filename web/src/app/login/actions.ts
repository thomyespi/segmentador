"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Usuarios internos: "tespinosa" equivale a "tespinosa@gen12.local". */
const USER_DOMAIN = "gen12.local";

export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const login = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!login || !password) return "Completá usuario y contraseña.";
  const email = login.includes("@") ? login : `${login}@${USER_DOMAIN}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return "Usuario o contraseña incorrectos.";
  redirect("/");
}
