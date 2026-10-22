"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { parseCsv } from "@/lib/csv";
import { missingHeaders, parseContactRows, parseOptOutFile, parseSendLog, type ParsedContacts } from "@/lib/import/contacts";
import { finishImport, importBatch, importLegacySends, importOptOuts, startImport } from "./actions";

const BATCH_SIZE = 500;
const SHEET = "Contactos";

export function ContactsImport() {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedContacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    setParsed(null);
    setError(null);
    setResult(null);
    setFile(f ?? null);
    if (!f) return;
    try {
      const workbook = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[SHEET];
      if (!sheet) {
        setError(`El archivo no tiene la hoja "${SHEET}".`);
        return;
      }
      const [headers = []] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0 });
      const missing = missingHeaders((headers as unknown[]).map((h) => String(h ?? "")));
      if (missing.length > 0) {
        setError(`Faltan columnas: ${missing.join(", ")}. No se importó nada.`);
        return;
      }
      setParsed(parseContactRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })));
    } catch (e) {
      setError(`No se pudo leer el Excel: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function onImport() {
    if (!parsed || !file) return;
    setError(null);
    setProgress(0);
    try {
      const importId = await startImport({
        fileName: file.name,
        rowsRead: parsed.rowsRead,
        invalid: parsed.invalid,
        duplicates: parsed.duplicates,
      });
      for (let i = 0; i < parsed.contacts.length; i += BATCH_SIZE) {
        await importBatch(importId, parsed.contacts.slice(i, i + BATCH_SIZE));
        setProgress(Math.min(parsed.contacts.length, i + BATCH_SIZE));
      }
      const totals = await finishImport(importId);
      setResult(
        `Listo: ${totals.inserted} creados, ${totals.updated} actualizados, ${totals.duplicates} duplicados, ` +
          `${totals.invalid} inválidos, ${totals.legacy_sends} envíos previos registrados.`,
      );
      setParsed(null);
    } catch (e) {
      setError(`Falló la importación: ${e instanceof Error ? e.message : String(e)}. Podés reintentar: no se duplica nada.`);
    } finally {
      setProgress(null);
    }
  }

  const sendable = parsed?.contacts.filter((c) => c.send_allowed).length ?? 0;

  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-semibold">Base de contactos (Excel)</h2>
      <p className="text-sm text-slate-600">
        Hoja “{SHEET}” de <em>Base segmentada Gen12.xlsx</em>. Se actualiza por número de WhatsApp: reimportar no
        borra envíos, estados, respuestas ni bajas.
      </p>
      <input type="file" accept=".xlsx" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      {error && <p className="text-sm text-red-700">{error}</p>}
      {parsed && (
        <div className="space-y-2 text-sm">
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-5">
            <li><strong>{parsed.rowsRead}</strong> filas</li>
            <li><strong>{parsed.contacts.length}</strong> contactos</li>
            <li><strong>{sendable}</strong> enviables</li>
            <li><strong>{parsed.duplicates.length}</strong> duplicados</li>
            <li><strong>{parsed.invalid.length}</strong> inválidos</li>
          </ul>
          <button className="btn btn-primary" onClick={onImport} disabled={progress !== null}>
            {progress !== null ? `Importando ${progress} / ${parsed.contacts.length}…` : "Importar"}
          </button>
        </div>
      )}
      {result && <p className="text-sm text-emerald-800">{result}</p>}
    </div>
  );
}

export function LegacyImport() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(kind: "bajas" | "log", f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setMessage(null);
    try {
      const text = await f.text();
      if (kind === "bajas") {
        const { phones, invalid } = parseOptOutFile(text);
        const n = await importOptOuts(f.name, phones, invalid);
        setMessage(`${n} bajas nuevas registradas${invalid.length ? ` (${invalid.length} líneas inválidas)` : ""}.`);
      } else {
        const rows = parseSendLog(parseCsv(text));
        const n = await importLegacySends(f.name, rows);
        setMessage(`${n} envíos previos registrados de ${rows.length} encontrados en el log.`);
      }
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-semibold">Historial del script anterior</h2>
      <p className="text-sm text-slate-600">
        Para no repetir envíos ni contactar a quien pidió la baja. Importá primero la base de contactos.
      </p>
      <label className="block text-sm">
        <span className="label">bajas.txt (un número por línea)</span>
        <input type="file" accept=".txt" disabled={busy} onChange={(e) => run("bajas", e.target.files?.[0])} />
      </label>
      <label className="block text-sm">
        <span className="label">envios_log.csv</span>
        <input type="file" accept=".csv" disabled={busy} onChange={(e) => run("log", e.target.files?.[0])} />
      </label>
      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}
