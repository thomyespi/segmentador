import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCampaignStats, getSendingState } from "@/lib/campaign-data";
import { formatDate, formatUsd } from "@/lib/labels";
import { HaltedBanner, PauseNotice, QuotaBar, StatusBadge } from "./components";

export default async function CampaignsPage() {
  const { supabase } = await requireUser();
  const [{ data: campaigns, error }, state] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    getSendingState(supabase),
  ]);
  if (error) throw new Error(error.message);
  const stats = await getCampaignStats(supabase, campaigns.map((c) => c.id));

  return (
    <div className="space-y-4">
      <HaltedBanner state={state} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">Campañas</h1>
        <Link href="/campanas/nueva" className="btn btn-primary">Nueva campaña</Link>
      </div>
      <div className="max-w-md">
        <QuotaBar state={state} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Estado</th>
              <th className="text-right">En cola</th>
              <th className="text-right">Enviados</th>
              <th className="text-right">Entregados</th>
              <th className="text-right">Leídos*</th>
              <th className="text-right">Fallidos</th>
              <th className="text-right">Respondieron</th>
              <th className="text-right">Me interesa</th>
              <th className="text-right">Bajas</th>
              <th className="text-right">Costo est.</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-500">
                  Todavía no hay campañas. <Link href="/campanas/nueva" className="underline">Creá la primera</Link>.
                </td>
              </tr>
            )}
            {campaigns.map((c) => {
              const s = stats.get(c.id)!;
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/campanas/${c.id}`} className="font-medium text-emerald-800 hover:underline">{c.name}</Link>
                    <div className="text-xs text-slate-500">{formatDate(c.created_at)}</div>
                  </td>
                  <td className="space-y-1">
                    <StatusBadge status={c.status} />
                    {c.status === "paused" && (
                      <PauseNotice code={c.pause_error_code} reason={c.pause_reason} pausedAt={c.paused_at} />
                    )}
                  </td>
                  <td className="text-right">{s.total.queued}</td>
                  <td className="text-right">{s.total.sent}</td>
                  <td className="text-right">{s.total.delivered}</td>
                  <td className="text-right">{s.total.read}</td>
                  <td className="text-right">{s.total.failed}</td>
                  <td className="text-right">{s.replied}</td>
                  <td className="text-right">{s.interested}</td>
                  <td className="text-right">{s.optedOut}</td>
                  <td className="text-right">{formatUsd(s.total.estimated_cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        * Leídos depende de que el destinatario tenga activadas las confirmaciones de lectura. El costo es estimado.
      </p>
    </div>
  );
}
