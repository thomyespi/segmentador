import type { AudiencePreview as Preview } from "@/lib/campaign-data";
import { EXCLUSION } from "@/lib/labels";
import { renderTemplate } from "@/lib/templates";

export function AudienceSummary(props: { eligible: number; excluded: { exclusion: string | null; total: number }[] }) {
  return (
    <div className="card">
      <p className="text-3xl font-semibold text-emerald-800">{props.eligible.toLocaleString("es-AR")}</p>
      <p className="text-sm text-slate-600">destinatarios elegibles</p>
      {props.excluded.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {props.excluded.map((e) => (
            <li key={e.exclusion} className="flex justify-between gap-4">
              <span>{EXCLUSION[e.exclusion ?? ""] ?? e.exclusion}</span>
              <span>{e.total.toLocaleString("es-AR")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El mensaje tal cual le llega al contacto: cuerpo con variables, pie y botones. */
export function MessagePreview({ row }: { row: Preview }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <span>
          {row.company} · {row.wa_phone}
        </span>
        <span>
          {row.rubro} · {row.zona} · <code>{row.template_name}</code>
        </span>
      </div>
      <div className="rounded-md bg-[#dcf8c6] p-3">
        <p className="whitespace-pre-line">{renderTemplate(row.body, [row.var_1, row.var_2])}</p>
        {row.footer && <p className="mt-2 text-xs text-slate-500">{row.footer}</p>}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {row.buttons.map((b) => (
          <span key={b.text} className="rounded-md bg-white py-1 text-center text-sky-700 shadow-sm ring-1 ring-slate-200">
            {b.text}
          </span>
        ))}
      </div>
    </div>
  );
}
