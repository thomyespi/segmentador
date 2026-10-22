import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user } = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold text-emerald-800">Gen12 · WhatsApp</Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link href="/" className="hover:underline">Campañas</Link>
            <Link href="/campanas/nueva" className="hover:underline">Nueva campaña</Link>
            <Link href="/importar" className="hover:underline">Importar</Link>
            <Link href="/configuracion" className="hover:underline">Configuración</Link>
          </nav>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{user.email}</span>
            <button className="btn">Salir</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
