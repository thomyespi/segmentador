import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/labels";
import { ContactsImport, LegacyImport } from "./import-forms";

const KIND: Record<string, string> = { contacts: "Contactos", opt_outs: "Bajas", send_log: "Log de envíos" };

export default async function ImportPage() {
  const { supabase } = await requireUser();
  const { data: imports, error } = await supabase
    .from("imports")
    .select("id, created_at, finished_at, kind, file_name, rows_read, inserted, updated, duplicates, invalid, legacy_sends")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Importar</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <ContactsImport />
        <LegacyImport />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th><th>Tipo</th><th>Archivo</th><th className="text-right">Filas</th>
              <th className="text-right">Creados</th><th className="text-right">Actualizados</th>
              <th className="text-right">Duplicados</th><th className="text-right">Inválidos</th>
              <th className="text-right">Envíos previos</th><th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((i) => {
              const hasDetail = i.kind === "contacts" && i.invalid + i.duplicates > 0;
              return (
                <tr key={i.id}>
                  <td>{formatDate(i.created_at)}{!i.finished_at && <span className="text-xs text-amber-700"> (incompleta)</span>}</td>
                  <td>{KIND[i.kind] ?? i.kind}</td>
                  <td>{i.file_name}</td>
                  <td className="text-right">{i.rows_read}</td>
                  <td className="text-right">{i.inserted}</td>
                  <td className="text-right">{i.updated}</td>
                  <td className="text-right">{i.duplicates}</td>
                  <td className="text-right">{i.invalid}</td>
                  <td className="text-right">{i.legacy_sends}</td>
                  <td>{hasDetail && <a className="underline" href={`/importar/${i.id}/detalle`}>CSV</a>}</td>
                </tr>
              );
            })}
            {imports.length === 0 && (
              <tr><td colSpan={10} className="py-6 text-center text-slate-500">Todavía no hay importaciones.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
