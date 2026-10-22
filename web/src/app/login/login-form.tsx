"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="card flex w-full max-w-sm flex-col gap-3">
      <h1 className="text-lg font-semibold">Gen12 · Campañas de WhatsApp</h1>
      <label>
        <span className="label">Usuario</span>
        <input className="input w-full" name="email" autoComplete="username" autoCapitalize="none" required />
      </label>
      <label>
        <span className="label">Contraseña</span>
        <input className="input w-full" type="password" name="password" autoComplete="current-password" required />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
      <p className="text-xs text-slate-500">Los usuarios se crean desde el panel de Supabase (no hay registro público).</p>
    </form>
  );
}
