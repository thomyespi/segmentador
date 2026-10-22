import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAudience, getCampaignFilters, getCampaignStats, getSendingState, type MessageStats } from "@/lib/campaign-data";
import { contactRowsQuery, filtersToSearchParams, parseContactRowFilters, type ContactRow } from "@/lib/contact-rows";
import { formatDate, formatUsd, INTENT, MESSAGE_STATUS, READ_NOTE, TEMPLATE_STATUS, TRIGGERS } from "@/lib/labels";
import {
  addFollowUpRule, cancelCampaign, confirmCampaign, deleteFollowUpRule, pauseCampaign, resolveUnknownMessage,
  resumeCampaign, runFollowUpsNow, toggleFollowUpRule, updateMaxFollowUps,
} from "../actions";
import { AudienceSummary, MessagePreview } from "../audience-preview";
import { HaltedBanner, PauseNotice, QuotaBar, StatusBadge } from "../../components";

const PAGE_SIZE = 50;

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3" title={hint}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}{hint ? " *" : ""}</p>
      <p className="text-xl font-semibold">{typeof value === "number" ? value.toLocaleString("es-AR") : value}</p>
    </div>
  );
}

function StatsBlock({ title, stats }: { title: string; stats: MessageStats }) {
  return (
    <div>
      <p className="label">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Metric label="En cola" value={stats.queued + stats.sending} />
        <Metric label="Enviados" value={stats.sent} />
        <Metric label="Entregados" value={stats.delivered} />
        <Metric label="Leídos" value={stats.read} hint={READ_NOTE} />
        <Metric label="Fallidos" value={stats.failed} />
        <Metric label="Inciertos" value={stats.unknown} />
        <Metric label="Cancelados" value={stats.cancelled} />
        <Metric label="Costo est." value={formatUsd(stats.estimated_cost)} />
      </div>
    </div>
  );
}

export default async function CampaignPage(props: PageProps<"/campanas/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const { supabase } = await requireUser();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!campaign) notFound();

  const filters = await getCampaignFilters(supabase, id);
  const state = await getSendingState(supabase);
  const hidden = <input type="hidden" name="campaign_id" value={id} />;

  return (
    <div className="space-y-6">
      <HaltedBanner state={state} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:underline">← Campañas</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {campaign.name} <StatusBadge status={campaign.status} />
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Rubros: {filters.rubros.join(", ") || "todos"} · Zonas: {filters.zonas.join(", ") || "todas"}
          </p>
          <p className="text-xs text-slate-500">
            Creada {formatDate(campaign.created_at)}
            {campaign.confirmed_at && ` · confirmada ${formatDate(campaign.confirmed_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {campaign.status === "sending" && (
            <form action={pauseCampaign}>{hidden}<button className="btn">Pausar</button></form>
          )}
          {campaign.status === "paused" && (
            <form action={resumeCampaign}>{hidden}<button className="btn btn-primary">Reanudar</button></form>
          )}
          {["draft", "sending", "paused"].includes(campaign.status) && (
            <form action={cancelCampaign}>{hidden}<button className="btn btn-danger">Cancelar campaña</button></form>
          )}
        </div>
      </div>

      {campaign.status === "paused" && (
        <PauseNotice code={campaign.pause_error_code} reason={campaign.pause_reason} pausedAt={campaign.paused_at} />
      )}

      {campaign.status === "draft" ? (
        <DraftSection campaignId={id} rubros={filters.rubros} zonas={filters.zonas} />
      ) : (
        <>
          <MetricsSection campaignId={id} />
          <div className="max-w-md"><QuotaBar state={state} /></div>
        </>
      )}

      <FollowUpSection campaignId={id} maxFollowUps={campaign.max_follow_ups} />

      {campaign.status !== "draft" && (
        <>
          <UnknownSection campaignId={id} />
          <ContactsSection campaignId={id} searchParams={searchParams} rubros={filters.rubros} zonas={filters.zonas} />
        </>
      )}
    </div>
  );

  async function DraftSection(p: { campaignId: string; rubros: string[]; zonas: string[] }) {
    const audience = await getAudience(supabase, p.rubros, p.zonas, 20);
    return (
      <section className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-3">
          <AudienceSummary eligible={audience.eligible} excluded={audience.excluded} />
          <form action={confirmCampaign} className="card space-y-2">
            {hidden}
            <p className="text-sm">
              Al confirmar se encolan <strong>{audience.eligible.toLocaleString("es-AR")}</strong> envíos con los datos
              de hoy. Salen en lotes, respetando el cupo diario y la ventana horaria.
            </p>
            <button className="btn btn-primary w-full" disabled={audience.eligible === 0}>Confirmar y encolar</button>
          </form>
        </div>
        <div className="space-y-3">
          <p className="label">Vista previa (primeros {audience.preview.length})</p>
          {audience.preview.map((row) => <MessagePreview key={row.contact_id} row={row} />)}
        </div>
      </section>
    );
  }

  async function MetricsSection({ campaignId }: { campaignId: string }) {
    const stats = (await getCampaignStats(supabase, [campaignId])).get(campaignId)!;
    return (
      <section className="card space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:max-w-lg">
          <Metric label="Respondieron" value={stats.replied} />
          <Metric label="Me interesa" value={stats.interested} />
          <Metric label="Bajas" value={stats.optedOut} />
        </div>
        <StatsBlock title="Envíos originales" stats={stats.original} />
        {stats.followUp.sent + stats.followUp.queued + stats.followUp.cancelled > 0 && (
          <>
            <StatsBlock title="Seguimientos" stats={stats.followUp} />
            <StatsBlock title="Total" stats={stats.total} />
          </>
        )}
        <p className="text-xs text-slate-500">* {READ_NOTE} Entregados incluye a los leídos. El costo es estimado con la tarifa de Configuración.</p>
      </section>
    );
  }

  async function FollowUpSection({ campaignId, maxFollowUps }: { campaignId: string; maxFollowUps: number }) {
    const [{ data: rules }, { data: templates }] = await Promise.all([
      supabase.from("follow_up_rules").select("*, templates(name, status)").eq("campaign_id", campaignId).order("step"),
      supabase.from("templates").select("id, name, status").eq("kind", "follow_up").order("name"),
    ]);
    const approved = (templates ?? []).filter((t) => t.status === "approved");
    return (
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Seguimientos automáticos</h2>
          <form action={runFollowUpsNow}>{hidden}<button className="btn">Evaluar reglas ahora</button></form>
        </div>
        <p className="text-sm text-slate-600">
          Se evalúan todos los días a las 10:00. La secuencia se corta si el contacto respondió, pidió la baja o el
          mensaje falló. Solo plantillas de seguimiento aprobadas: se envían fuera de la ventana de 24 h.
        </p>

        <form action={updateMaxFollowUps} className="flex items-end gap-2">
          {hidden}
          <label>
            <span className="label">Máximo por contacto</span>
            <input className="input w-20" type="number" name="max_follow_ups" min={0} max={5} defaultValue={maxFollowUps} />
          </label>
          <button className="btn">Guardar</button>
        </form>

        {(rules ?? []).length > 0 && (
          <table className="table">
            <thead><tr><th>Paso</th><th>Disparador</th><th>Plantilla</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {(rules ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.step}</td>
                  <td>{TRIGGERS[r.trigger]} a los {r.delay_days} días</td>
                  <td>
                    <code>{r.templates?.name}</code>
                    {r.templates?.status !== "approved" && (
                      <p className="text-xs text-red-700">
                        Plantilla {TEMPLATE_STATUS[r.templates?.status] ?? r.templates?.status}: esta regla no encola nada.
                      </p>
                    )}
                  </td>
                  <td>{r.active ? "Activa" : "Inactiva"}</td>
                  <td className="flex gap-2">
                    <form action={toggleFollowUpRule}>
                      {hidden}
                      <input type="hidden" name="rule_id" value={r.id} />
                      <input type="hidden" name="active" value={String(!r.active)} />
                      <button className="btn">{r.active ? "Desactivar" : "Activar"}</button>
                    </form>
                    <form action={deleteFollowUpRule}>
                      {hidden}
                      <input type="hidden" name="rule_id" value={r.id} />
                      <button className="btn btn-danger">Borrar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={addFollowUpRule} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          {hidden}
          <label>
            <span className="label">Disparador</span>
            <select className="input" name="trigger" defaultValue="read_no_reply">
              <option value="read_no_reply">{TRIGGERS.read_no_reply}</option>
              <option value="delivered_not_read">{TRIGGERS.delivered_not_read}</option>
            </select>
          </label>
          <label>
            <span className="label">A los N días</span>
            <input className="input w-20" type="number" name="delay_days" min={1} max={60} defaultValue={3} required />
          </label>
          <label>
            <span className="label">Plantilla</span>
            <select className="input" name="template_id" required disabled={approved.length === 0}>
              {approved.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" disabled={approved.length === 0}>Agregar regla</button>
          {approved.length === 0 && (
            <p className="w-full text-xs text-red-700">
              No hay plantillas de seguimiento aprobadas. Cargala en Meta y marcala como aprobada en Configuración.
            </p>
          )}
          <p className="w-full text-xs text-amber-800">
            “Entregado pero no leído” depende de las confirmaciones de lectura: puede alcanzar a gente que sí leyó.
          </p>
        </form>
      </section>
    );
  }

  async function UnknownSection({ campaignId }: { campaignId: string }) {
    const { data } = await supabase
      .from("messages")
      .select("id, locked_at, contacts(company, wa_phone), templates(name)")
      .eq("campaign_id", campaignId)
      .eq("status", "unknown")
      .limit(100);
    if (!data || data.length === 0) return null;
    return (
      <section className="card space-y-2 border-amber-300">
        <h2 className="text-lg font-semibold">Envíos inciertos ({data.length})</h2>
        <p className="text-sm text-slate-600">
          El envío se cortó sin saber si Meta lo aceptó. Revisalo en WhatsApp Manager antes de decidir: reencolar
          puede duplicar el mensaje.
        </p>
        <table className="table">
          <tbody>
            {data.map((m) => {
              const contact = m.contacts as unknown as { company: string; wa_phone: string } | null;
              const template = m.templates as unknown as { name: string } | null;
              return (
                <tr key={m.id}>
                  <td>{contact?.company} · {contact?.wa_phone}</td>
                  <td><code>{template?.name}</code></td>
                  <td>{formatDate(m.locked_at)}</td>
                  <td className="flex gap-2">
                    {(["sent", "requeue"] as const).map((outcome) => (
                      <form key={outcome} action={resolveUnknownMessage}>
                        {hidden}
                        <input type="hidden" name="message_id" value={m.id} />
                        <input type="hidden" name="outcome" value={outcome} />
                        <button className="btn">{outcome === "sent" ? "Se envió" : "Reencolar"}</button>
                      </form>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  }

  async function ContactsSection(p: {
    campaignId: string;
    searchParams: Record<string, string | string[] | undefined>;
    rubros: string[];
    zonas: string[];
  }) {
    const rowFilters = parseContactRowFilters(p.searchParams);
    const page = Math.max(1, Number(p.searchParams.pagina) || 1);
    const { data, count, error } = await contactRowsQuery(supabase, p.campaignId, rowFilters, { count: true })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ContactRow[];
    const total = count ?? 0;
    const query = filtersToSearchParams(rowFilters);
    const pageLink = (n: number) => {
      const q = new URLSearchParams(query);
      q.set("pagina", String(n));
      return `?${q.toString()}`;
    };

    return (
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Contactos ({total.toLocaleString("es-AR")})</h2>
          <a className="btn" href={`/campanas/${p.campaignId}/export?${query.toString()}`}>Exportar CSV</a>
        </div>

        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label>
            <span className="label">Estado</span>
            <select className="input" name="estado" defaultValue={rowFilters.status ?? ""}>
              <option value="">Todos</option>
              {Object.entries(MESSAGE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Rubro</span>
            <input className="input" name="rubro" list="rubros" defaultValue={rowFilters.rubro ?? ""} />
            <datalist id="rubros">{p.rubros.map((r) => <option key={r} value={r} />)}</datalist>
          </label>
          <label>
            <span className="label">Zona</span>
            <input className="input" name="zona" list="zonas" defaultValue={rowFilters.zona ?? ""} />
            <datalist id="zonas">{p.zonas.map((z) => <option key={z} value={z} />)}</datalist>
          </label>
          <label>
            <span className="label">Respondió</span>
            <select className="input" name="respondio" defaultValue={rowFilters.replied ?? ""}>
              <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
            </select>
          </label>
          <label className="flex items-center gap-1 pb-2">
            <input type="checkbox" name="interesa" value="si" defaultChecked={rowFilters.interested === "si"} /> Me interesa
          </label>
          <label>
            <span className="label">Baja</span>
            <select className="input" name="baja" defaultValue={rowFilters.optedOut ?? ""}>
              <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
            </select>
          </label>
          <label>
            <span className="label">Buscar</span>
            <input className="input" name="q" placeholder="Nombre, empresa o número" defaultValue={rowFilters.q ?? ""} />
          </label>
          <button className="btn btn-primary">Filtrar</button>
          <Link href={`/campanas/${p.campaignId}`} className="btn">Limpiar</Link>
        </form>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Contacto</th><th>Rubro / zona</th><th>Estado</th><th>Enviado</th><th>Entregado</th><th>Leído</th>
                <th>Seg.</th><th>Última respuesta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.message_id}>
                  <td>
                    <p className="font-medium">{r.company}</p>
                    <p className="text-xs text-slate-500">{r.contact_name} · {r.wa_phone}</p>
                    {r.opted_out && <span className="text-xs font-semibold text-red-700">Baja</span>}
                  </td>
                  <td className="text-xs">{r.rubro}<br />{r.zona}</td>
                  <td>
                    {MESSAGE_STATUS[r.status] ?? r.status}
                    {r.error_code && <p className="max-w-xs text-xs text-red-700">{r.error_code} · {r.error_title}</p>}
                  </td>
                  <td className="text-xs">{formatDate(r.sent_at)}</td>
                  <td className="text-xs">{formatDate(r.delivered_at)}</td>
                  <td className="text-xs">{formatDate(r.read_at)}</td>
                  <td>{r.follow_ups > 0 ? `${r.follow_ups} (${MESSAGE_STATUS[r.last_follow_up_status ?? ""] ?? ""})` : "—"}</td>
                  <td className="max-w-xs">
                    {r.last_reply_at ? (
                      <>
                        <span className={r.last_reply_intent === "interested" ? "font-semibold text-emerald-800" : ""}>
                          {INTENT[r.last_reply_intent ?? "other"]}
                        </span>
                        <p className="truncate text-xs text-slate-600" title={r.last_reply_text ?? ""}>{r.last_reply_text}</p>
                        <p className="text-xs text-slate-500">{formatDate(r.last_reply_at)}</p>
                      </>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-500">Sin contactos para estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center gap-3 text-sm">
            {page > 1 && <Link className="btn" href={pageLink(page - 1)}>Anterior</Link>}
            <span>Página {page} de {Math.ceil(total / PAGE_SIZE)}</span>
            {page * PAGE_SIZE < total && <Link className="btn" href={pageLink(page + 1)}>Siguiente</Link>}
          </div>
        )}
      </section>
    );
  }
}
