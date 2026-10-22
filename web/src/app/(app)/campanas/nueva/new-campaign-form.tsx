"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createCampaign, previewAudience } from "../actions";
import { AudienceSummary, MessagePreview } from "../audience-preview";

type Facet = { value: string; total: number };
type Audience = Awaited<ReturnType<typeof previewAudience>>;

function FacetPicker(props: { title: string; name: string; options: Facet[]; selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (value: string) =>
    props.onChange(props.selected.includes(value) ? props.selected.filter((v) => v !== value) : [...props.selected, value]);
  return (
    <fieldset className="card">
      <legend className="label px-1">{props.title}</legend>
      <div className="mb-2 flex gap-2 text-xs">
        <button type="button" className="underline" onClick={() => props.onChange(props.options.map((o) => o.value))}>Todos</button>
        <button type="button" className="underline" onClick={() => props.onChange([])}>Ninguno</button>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-2">
        {props.options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <input type="checkbox" name={props.name} value={o.value} checked={props.selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.value}
            </span>
            <span className="text-xs text-slate-500">{Number(o.total).toLocaleString("es-AR")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NewCampaignForm({ rubros, zonas }: { rubros: Facet[]; zonas: Facet[] }) {
  const [selectedRubros, setRubros] = useState<string[]>([]);
  const [selectedZonas, setZonas] = useState<string[]>([]);
  const [result, setResult] = useState<Audience | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, action, creating] = useActionState(createCampaign, null);

  const hasFilters = selectedRubros.length > 0 || selectedZonas.length > 0;
  const audience = hasFilters ? result : null;

  // Conteo y vista previa en vivo al cambiar los filtros.
  useEffect(() => {
    if (!hasFilters) return;
    const timer = setTimeout(() => {
      startLoading(async () => setResult(await previewAudience(selectedRubros, selectedZonas)));
    }, 300);
    return () => clearTimeout(timer);
  }, [hasFilters, selectedRubros, selectedZonas]);

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1fr_1fr_1.3fr]">
      <FacetPicker title="Rubros" name="rubro" options={rubros} selected={selectedRubros} onChange={setRubros} />
      <FacetPicker title="Zonas" name="zona" options={zonas} selected={selectedZonas} onChange={setZonas} />

      <div className="space-y-4">
        <div className="card space-y-3">
          <label className="block">
            <span className="label">Nombre</span>
            <input className="input w-full" name="name" placeholder="Construcción · Neuquén · oct 2026" required />
          </label>
          <label className="block">
            <span className="label">Máximo de seguimientos por contacto</span>
            <input className="input w-24" type="number" name="max_follow_ups" min={0} max={5} defaultValue={1} />
          </label>
          <p className="text-xs text-slate-500">Sin zona elegida se toman todas las zonas (y lo mismo con rubros).</p>
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
          <button className="btn btn-primary w-full" disabled={creating || !audience || audience.eligible === 0}>
            {creating ? "Creando…" : "Crear borrador"}
          </button>
          <p className="text-xs text-slate-500">El borrador no envía nada: los envíos se encolan recién al confirmar.</p>
        </div>

        {loading && !audience && <p className="text-sm text-slate-500">Calculando…</p>}
        {audience && (
          <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
            <AudienceSummary eligible={audience.eligible} excluded={audience.excluded} />
            <p className="label">Vista previa (primeros {audience.preview.length})</p>
            {audience.preview.map((row) => (
              <MessagePreview key={row.contact_id} row={row} />
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
