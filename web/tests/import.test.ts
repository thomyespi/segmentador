import { beforeEach, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { missingHeaders, parseContactRows, parseOptOutFile, parseSendLog, REQUIRED_HEADERS } from "@/lib/import/contacts";
import { parseCsv } from "@/lib/csv";
import { createTestDb } from "./helpers/db";
import { messagesOf, one, pgliteRpc } from "./helpers/fixtures";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: 1,
    Enviar: "SI",
    "Motivo exclusión": null,
    Contacto: "Octavio Pérez",
    Empresa: "369 Seguridad y Energía",
    "Rubro Gen12": "Energía, oil & gas y minería",
    "Origen del rubro": "Rubro original",
    Zona: "Neuquén",
    "Origen de la zona": "Localidad",
    WhatsApp: "5492991234567",
    Plantilla: "gen12_energia",
    "Variable 1 (nombre)": "Octavio",
    "Variable 2 (empresa)": "369 Seguridad y Energía",
    "Estado envío": null,
    "Nombre original": "OCTAVIO PEREZ",
    "CUIT/DNI": "20-12345678-9",
    ...overrides,
  };
}

describe("parseContactRows", () => {
  test("detecta encabezados faltantes", () => {
    expect(missingHeaders([...REQUIRED_HEADERS])).toEqual([]);
    expect(missingHeaders(REQUIRED_HEADERS.filter((h) => h !== "WhatsApp"))).toEqual(["WhatsApp"]);
  });

  test("número inválido no se importa y queda en el reporte", () => {
    const parsed = parseContactRows([row({ ID: 7, WhatsApp: "919327377523" }), row({ ID: 8, WhatsApp: null })]);
    expect(parsed.contacts).toHaveLength(0);
    expect(parsed.invalid.map((r) => r.excel_id)).toEqual(["7", "8"]);
  });

  test("normaliza teléfonos con caracteres no numéricos y guarda datos originales", () => {
    const parsed = parseContactRows([row({ WhatsApp: "+54 9 299 123-4567" })]);
    expect(parsed.contacts[0].wa_phone).toBe("5492991234567");
    expect(parsed.contacts[0].original).toMatchObject({ nombre_original: "OCTAVIO PEREZ", cuit_dni: "20-12345678-9" });
  });

  test("duplicado: gana la fila de menor ID", () => {
    const parsed = parseContactRows([row({ ID: 9, Empresa: "B" }), row({ ID: 3, Empresa: "A" })]);
    expect(parsed.contacts).toHaveLength(1);
    expect(parsed.contacts[0]).toMatchObject({ excel_id: "3", company: "A", send_allowed: true });
    expect(parsed.duplicates).toEqual([expect.objectContaining({ excel_id: "9", kept_excel_id: "3" })]);
  });

  test("duplicado con Enviar=NO deja el contacto como no enviable", () => {
    const parsed = parseContactRows([
      row({ ID: 1 }),
      row({ ID: 2, Enviar: "NO", "Motivo exclusión": "Competencia" }),
    ]);
    expect(parsed.contacts[0]).toMatchObject({ excel_id: "1", send_allowed: false, exclusion_reason: "Competencia" });
  });

  test("la copia marcada 'Teléfono repetido' no bloquea al original", () => {
    const parsed = parseContactRows([
      row({ ID: 1, Enviar: "NO", "Motivo exclusión": "Teléfono repetido" }),
      row({ ID: 2, Enviar: "SI" }),
    ]);
    expect(parsed.contacts).toHaveLength(1);
    expect(parsed.contacts[0]).toMatchObject({ excel_id: "2", send_allowed: true, exclusion_reason: null });
    expect(parsed.duplicates).toHaveLength(1);
  });

  test("Estado envío 'enviado …' marca envío legacy", () => {
    const parsed = parseContactRows([row({ "Estado envío": "enviado 15/10" })]);
    expect(parsed.contacts[0].legacy_sent).toBe(true);
  });

  test("bajas.txt ignora comentarios y vacías", () => {
    const { phones, invalid } = parseOptOutFile("# Un número por línea\n\n5492991234567\n 5492991234567 \nhola\n");
    expect(phones).toEqual(["5492991234567"]);
    expect(invalid).toEqual(["hola"]);
  });

  test("envios_log.csv toma solo los enviados", () => {
    const rows = parseCsv(
      'fecha,id,whatsapp,empresa,plantilla,estado,detalle\n' +
        '2026-10-15T10:00:00,1,5492991234567,"Empresa, SA",gen12_energia,enviado,wamid.1\n' +
        "2026-10-15T10:00:01,2,5492991234568,X,gen12_energia,error,131026\n",
    );
    expect(parseSendLog(rows)).toEqual([{ wa_phone: "5492991234567", template_name: "gen12_energia" }]);
  });
});

describe("import_contacts (SQL)", () => {
  let db: PGlite;
  let importId: string;
  const rpc = () => pgliteRpc(db);

  beforeEach(async () => {
    db = await createTestDb();
    importId = (await one<{ id: string }>(db, `insert into public.imports (file_name) values ('x.xlsx') returning id`)).id;
  });

  test("upsert por WhatsApp: actualiza datos sin crear otro contacto", async () => {
    const first = parseContactRows([row()]).contacts;
    await rpc()("import_contacts", { p_import_id: importId, p_rows: first });
    const second = parseContactRows([row({ Empresa: "Nueva SA", Zona: "Río Negro" })]).contacts;
    const result = await rpc()<{ inserted: number; updated: number }>("import_contacts", {
      p_import_id: importId,
      p_rows: second,
    });
    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    const c = await one(db, `select count(*)::int as n, max(company) as company, max(zona) as zona from public.contacts`);
    expect(c).toEqual({ n: 1, company: "Nueva SA", zona: "Río Negro" });
  });

  test("reimportar no pisa envíos ni revierte bajas", async () => {
    await rpc()("import_contacts", { p_import_id: importId, p_rows: parseContactRows([row()]).contacts });
    const contact = await one<{ id: string }>(db, `select id from public.contacts`);
    const template = await one<{ id: string }>(db, `select id from public.templates where name = 'gen12_energia'`);
    const campaign = await one<{ id: string }>(db, `insert into public.campaigns (name) values ('c') returning id`);
    await db.query(
      `insert into public.messages (campaign_id, contact_id, template_id, kind, status, wamid, sent_at, read_at)
       values ($1, $2, $3, 'campaign', 'read', 'wamid.X', now(), now())`,
      [campaign.id, contact.id, template.id],
    );
    await rpc()("register_opt_out", { p_phone: "5492991234567", p_source: "button" });

    await rpc()("import_contacts", { p_import_id: importId, p_rows: parseContactRows([row({ Enviar: "SI" })]).contacts });

    const msgs = await messagesOf(db, contact.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ status: "read", wamid: "wamid.X" });
    const c = await one<{ opted_out_at: unknown }>(db, `select opted_out_at from public.contacts`);
    expect(c.opted_out_at).not.toBeNull();
    const audience = await rpc()<{ exclusion: string }[]>("campaign_candidates", { p_rubros: [], p_zonas: [] });
    expect(audience[0].exclusion).toBe("baja");
  });

  test("Enviar=NO queda excluido de las campañas", async () => {
    const rows = parseContactRows([row({ Enviar: "NO", "Motivo exclusión": "Competencia" })]).contacts;
    await rpc()("import_contacts", { p_import_id: importId, p_rows: rows });
    const audience = await rpc()<{ exclusion: string }[]>("campaign_candidates", { p_rubros: [], p_zonas: [] });
    expect(audience).toEqual([expect.objectContaining({ exclusion: "enviar_no" })]);
  });

  test("envío legacy bloquea esa plantilla para el número", async () => {
    const rows = parseContactRows([row({ "Estado envío": "enviado 15/10" })]).contacts;
    const result = await rpc()<{ legacy_sends: number }>("import_contacts", { p_import_id: importId, p_rows: rows });
    expect(result.legacy_sends).toBe(1);
    const audience = await rpc()<{ exclusion: string }[]>("campaign_candidates", { p_rubros: [], p_zonas: [] });
    expect(audience[0].exclusion).toBe("ya_recibida");
  });

  test("bajas.txt registra bajas con origen legacy_file", async () => {
    await rpc()("import_contacts", { p_import_id: importId, p_rows: parseContactRows([row()]).contacts });
    const n = await rpc()<number>("import_opt_outs", { p_phones: ["5492991234567", "5492990000000"] });
    expect(n).toBe(2);
    const o = await one(db, `select source from public.opt_outs where wa_phone = '5492991234567'`);
    expect(o).toEqual({ source: "legacy_file" });
  });
});
