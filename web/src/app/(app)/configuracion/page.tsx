import { requireUser } from "@/lib/auth";
import { getSendingState } from "@/lib/campaign-data";
import { formatDate, TEMPLATE_STATUS } from "@/lib/labels";
import { resumeSending, setTemplateStatus, updateSettings } from "./actions";

export default async function SettingsPage() {
  const { supabase } = await requireUser();
  const [state, { data: templates, error }] = await Promise.all([
    getSendingState(supabase),
    supabase.from("templates").select("*").order("kind").order("name"),
  ]);
  if (error) throw new Error(error.message);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configuración</h1>

      {state.halted && (
        <form action={resumeSending} className="card space-y-2 border-red-300 bg-red-50 text-sm text-red-900">
          <p className="font-semibold">Envíos frenados desde {formatDate(state.haltedAt)}</p>
          <p>{state.haltReason}</p>
          <p>Reactivá solo después de revisar el token y el estado del número en Meta. Las campañas pausadas siguen pausadas.</p>
          <button className="btn btn-primary">Reactivar envíos</button>
        </form>
      )}

      <form action={updateSettings} className="card grid max-w-2xl gap-4 sm:grid-cols-2">
        <label>
          <span className="label">Tope diario de destinatarios únicos</span>
          <input className="input w-full" type="number" name="daily_cap" min={0} defaultValue={state.dailyCap} />
          <span className="text-xs text-slate-500">Ventana móvil de 24 h. Meta arranca con 250 por número nuevo.</span>
        </label>
        <label>
          <span className="label">Mensajes por lote (cada 10 min)</span>
          <input className="input w-full" type="number" name="batch_size" min={1} max={200} defaultValue={state.batchSize} />
        </label>
        <label>
          <span className="label">Enviar desde (hora Argentina)</span>
          <input className="input w-full" type="time" name="send_window_start" defaultValue={state.windowStart} />
        </label>
        <label>
          <span className="label">Hasta</span>
          <input className="input w-full" type="time" name="send_window_end" defaultValue={state.windowEnd} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Tarifa de marketing (USD por mensaje facturable)</span>
          <input className="input w-40" name="marketing_rate_usd" inputMode="decimal" defaultValue={state.marketingRate} />
          <span className="ml-2 text-xs text-slate-500">Para el costo estimado. Tomala de la lista de precios de Meta para Argentina.</span>
        </label>
        <div className="sm:col-span-2"><button className="btn btn-primary">Guardar</button></div>
      </form>

      <section className="card overflow-x-auto p-0">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Plantillas</h2>
          <p className="text-sm text-slate-600">
            El webhook de Meta actualiza el estado solo. Si no está suscripto <code>message_template_status_update</code>,
            marcala a mano cuando WhatsApp Manager la apruebe.
          </p>
        </div>
        <table className="table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Rubro</th><th>Estado</th><th>Calidad</th><th /></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <code>{t.name}</code>
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer">Ver texto</summary>
                    <p className="mt-1 max-w-xl whitespace-pre-line">{t.body}</p>
                    <p className="mt-1 text-slate-500">{t.footer}</p>
                  </details>
                </td>
                <td>{t.kind === "campaign" ? "Campaña" : "Seguimiento"}</td>
                <td className="text-xs">{t.rubro ?? "—"}</td>
                <td>
                  {TEMPLATE_STATUS[t.status] ?? t.status}
                  {t.status_reason && <p className="text-xs text-slate-500">{t.status_reason}</p>}
                </td>
                <td className="text-xs">{t.quality ?? "—"}</td>
                <td>
                  <form action={setTemplateStatus} className="flex gap-1">
                    <input type="hidden" name="template_id" value={t.id} />
                    <select className="input" name="status" defaultValue={t.status}>
                      {Object.entries(TEMPLATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button className="btn">Cambiar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
