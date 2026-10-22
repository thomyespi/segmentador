import { normalizeWaPhone } from "../phone";

export const REQUIRED_HEADERS = [
  "ID", "Enviar", "Motivo exclusión", "Contacto", "Empresa", "Rubro Gen12", "Origen del rubro", "Zona",
  "Origen de la zona", "WhatsApp", "Plantilla", "Variable 1 (nombre)", "Variable 2 (empresa)", "Estado envío",
] as const;

const ORIGINAL_HEADERS: Record<string, string> = {
  "Nombre original": "nombre_original",
  "Localidad original": "localidad_original",
  "Rubro original": "rubro_original",
  "Segmento original": "segmento_original",
  "CUIT/DNI": "cuit_dni",
  "Tiene página?": "tiene_pagina",
  Asesor: "asesor",
};

/** La segmentación marca así las copias de un mismo teléfono. */
export const DUPLICATE_REASON = "Teléfono repetido";

export type ContactImportRow = {
  wa_phone: string;
  excel_id: string;
  contact_name: string | null;
  company: string | null;
  rubro: string | null;
  rubro_source: string | null;
  zona: string | null;
  zona_source: string | null;
  var_1: string | null;
  var_2: string | null;
  template_name: string | null;
  send_allowed: boolean;
  exclusion_reason: string | null;
  original: Record<string, string>;
  legacy_sent: boolean;
};

export type RejectedRow = { excel_id: string; whatsapp: string; reason: string; kept_excel_id?: string };

export type ParsedContacts = {
  rowsRead: number;
  contacts: ContactImportRow[];
  invalid: RejectedRow[];
  duplicates: RejectedRow[];
};

export function missingHeaders(headers: string[]): string[] {
  const present = new Set(headers.map((h) => h.trim()));
  return REQUIRED_HEADERS.filter((h) => !present.has(h));
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function idOrder(a: { excel_id: string }, b: { excel_id: string }): number {
  const na = Number(a.excel_id);
  const nb = Number(b.excel_id);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.excel_id.localeCompare(b.excel_id);
}

/** Filas de la hoja "Contactos" (objetos por encabezado) → contactos listos para el upsert. */
export function parseContactRows(rows: Record<string, unknown>[]): ParsedContacts {
  const invalid: RejectedRow[] = [];
  const byPhone = new Map<string, ContactImportRow[]>();

  rows.forEach((row, index) => {
    const excelId = str(row["ID"]) ?? `fila ${index + 2}`;
    const phone = normalizeWaPhone(row["WhatsApp"]);
    if (!phone) {
      invalid.push({ excel_id: excelId, whatsapp: str(row["WhatsApp"]) ?? "", reason: "WhatsApp con formato inválido" });
      return;
    }
    const sendAllowed = str(row["Enviar"])?.toUpperCase() === "SI";
    const original: Record<string, string> = {};
    for (const [header, key] of Object.entries(ORIGINAL_HEADERS)) {
      const value = str(row[header]);
      if (value !== null) original[key] = value;
    }
    const contact: ContactImportRow = {
      wa_phone: phone,
      excel_id: excelId,
      contact_name: str(row["Contacto"]),
      company: str(row["Empresa"]),
      rubro: str(row["Rubro Gen12"]),
      rubro_source: str(row["Origen del rubro"]),
      zona: str(row["Zona"]),
      zona_source: str(row["Origen de la zona"]),
      var_1: str(row["Variable 1 (nombre)"]),
      var_2: str(row["Variable 2 (empresa)"]),
      template_name: str(row["Plantilla"]),
      send_allowed: sendAllowed,
      exclusion_reason: sendAllowed ? null : (str(row["Motivo exclusión"]) ?? "Enviar distinto de SI"),
      original,
      legacy_sent: /^enviado/i.test(str(row["Estado envío"]) ?? ""),
    };
    const group = byPhone.get(phone);
    if (group) group.push(contact);
    else byPhone.set(phone, [contact]);
  });

  const contacts: ContactImportRow[] = [];
  const duplicates: RejectedRow[] = [];

  for (const group of byPhone.values()) {
    group.sort(idOrder);
    // Las copias marcadas "Teléfono repetido" no cuentan si hay otra fila del mismo número.
    const relevant = group.filter((c) => c.send_allowed || c.exclusion_reason !== DUPLICATE_REASON);
    const candidates = relevant.length > 0 ? relevant : group;
    const first = candidates[0];
    const kept = { ...first };
    const excluded = candidates.find((c) => !c.send_allowed);
    if (excluded) {
      kept.send_allowed = false;
      kept.exclusion_reason = excluded.exclusion_reason;
    }
    kept.legacy_sent = group.some((c) => c.legacy_sent);
    contacts.push(kept);
    for (const other of group) {
      if (other === first) continue;
      duplicates.push({
        excel_id: other.excel_id,
        whatsapp: other.wa_phone,
        reason: "Teléfono duplicado en el archivo",
        kept_excel_id: kept.excel_id,
      });
    }
  }

  contacts.sort(idOrder);
  return { rowsRead: rows.length, contacts, invalid, duplicates };
}

/** bajas.txt: un número por línea; ignora vacías y comentarios (#). */
export function parseOptOutFile(text: string): { phones: string[]; invalid: string[] } {
  const phones = new Set<string>();
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const phone = normalizeWaPhone(trimmed);
    if (phone) phones.add(phone);
    else invalid.push(trimmed);
  }
  return { phones: [...phones], invalid };
}

/** envios_log.csv del script anterior: fecha,id,whatsapp,empresa,plantilla,estado,detalle. */
export function parseSendLog(rows: string[][]): { wa_phone: string; template_name: string }[] {
  const [header, ...data] = rows;
  if (!header) return [];
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iPhone = col("whatsapp");
  const iTemplate = col("plantilla");
  const iStatus = col("estado");
  if (iPhone < 0 || iTemplate < 0 || iStatus < 0) return [];
  const seen = new Set<string>();
  const out: { wa_phone: string; template_name: string }[] = [];
  for (const row of data) {
    const phone = normalizeWaPhone(row[iPhone]);
    const template = row[iTemplate]?.trim();
    if (!phone || !template || row[iStatus]?.trim() !== "enviado") continue;
    const key = `${phone}:${template}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ wa_phone: phone, template_name: template });
  }
  return out;
}
