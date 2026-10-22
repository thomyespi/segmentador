import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runDispatch } from "@/lib/dispatch";
import { rpcDispatchStore } from "@/lib/dispatch-store";
import { buildTemplatePayload, type SendResult, type SendTemplateInput } from "@/lib/whatsapp/client";
import { classifySendError } from "@/lib/whatsapp/errors";
import { renderTemplate } from "@/lib/templates";
import { createTestDb } from "./helpers/db";
import { createCampaign, insertContact, messagesOf, one, pgliteRpc } from "./helpers/fixtures";

let db: PGlite;
const rpc = () => pgliteRpc(db);

beforeEach(async () => {
  db = await createTestDb();
});

async function confirm(campaignId: string) {
  return rpc()<number>("enqueue_campaign", { p_campaign_id: campaignId });
}

let wamidSeq = 0;

function okSender() {
  return vi.fn<(input: SendTemplateInput) => Promise<SendResult>>(async () => ({ ok: true, wamid: `wamid.${++wamidSeq}` }));
}

function dispatch(send: (input: SendTemplateInput) => Promise<SendResult>, batchSize = 50) {
  return runDispatch({
    store: rpcDispatchStore(rpc(), async () => batchSize),
    send,
    sleep: async () => undefined,
  });
}

describe("audiencia y vista previa", () => {
  test("filtra por rubro Y zona con multiselección y desglosa excluidos", async () => {
    await insertContact(db, { rubro: "Construcción y materiales", zona: "Neuquén", template_name: "gen12_construccion" });
    await insertContact(db, { rubro: "Industria y maquinaria", zona: "Río Negro", template_name: "gen12_industria" });
    await insertContact(db, { rubro: "Industria y maquinaria", zona: "AMBA", template_name: "gen12_industria" });
    await insertContact(db, { rubro: "Construcción y materiales", zona: "Neuquén", send_allowed: false });
    const counts = await rpc()<{ exclusion: string | null; total: number }[]>("campaign_audience_counts", {
      p_rubros: ["Construcción y materiales", "Industria y maquinaria"],
      p_zonas: ["Neuquén", "Río Negro"],
    });
    const byReason = Object.fromEntries(counts.map((c) => [c.exclusion ?? "elegibles", Number(c.total)]));
    expect(byReason).toEqual({ elegibles: 2, enviar_no: 1 });
  });

  test("sin filtro de zona considera todas las zonas", async () => {
    await insertContact(db, { zona: "Neuquén" });
    await insertContact(db, { zona: "AMBA" });
    const rows = await rpc()<unknown[]>("campaign_candidates", { p_rubros: ["Energía, oil & gas y minería"], p_zonas: [] });
    expect(rows).toHaveLength(2);
  });

  test("vista previa con variables reemplazadas", async () => {
    await insertContact(db);
    const [p] = await rpc()<{ body: string; var_1: string; var_2: string; footer: string }[]>("campaign_preview", {
      p_rubros: [], p_zonas: [], p_limit: 10, p_offset: 0,
    });
    const text = renderTemplate(p.body, [p.var_1, p.var_2]);
    expect(text).toContain("Hola Octavio");
    expect(text).toContain("para 369 Seguridad y Energía");
    expect(p.footer).toContain("BAJA");
  });

  test("payload de Meta con variables y payloads de botones", () => {
    const body = buildTemplatePayload({ to: "549", template: "gen12_energia", language: "es_AR", variables: ["A", "B"] });
    expect(body.template.components[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "A" }, { type: "text", text: "B" }] });
    expect(body.template.components.slice(1).map((c) => ("parameters" in c ? c.parameters[0] : null))).toEqual([
      { type: "payload", payload: "ME_INTERESA" },
      { type: "payload", payload: "NO_GRACIAS" },
    ]);
  });
});

describe("encolado", () => {
  test("confirmar encola a los elegibles y congela variables", async () => {
    const c = await insertContact(db);
    await insertContact(db, { send_allowed: false });
    const campaign = await createCampaign(db);
    expect(await confirm(campaign)).toBe(1);
    await db.query(`update public.contacts set var_1 = 'Otro' where id = $1`, [c.id]);
    const [m] = await messagesOf(db, c.id);
    expect(m).toMatchObject({ status: "queued", variables: ["Octavio", "369 Seguridad y Energía"] });
    expect(await one(db, `select status from public.campaigns where id = $1`, [campaign])).toEqual({ status: "sending" });
  });

  test("no se puede confirmar dos veces", async () => {
    await insertContact(db);
    const campaign = await createCampaign(db);
    await confirm(campaign);
    await expect(confirm(campaign)).rejects.toThrow(/ya fue confirmada/);
  });

  test("nunca la misma plantilla de campaña dos veces al mismo número", async () => {
    const c = await insertContact(db);
    const first = await createCampaign(db);
    expect(await confirm(first)).toBe(1);
    const second = await createCampaign(db);
    expect(await confirm(second)).toBe(0);
    const counts = await rpc()<{ exclusion: string }[]>("campaign_candidates", { p_rubros: [], p_zonas: [] });
    expect(counts[0].exclusion).toBe("ya_recibida");
    expect(await messagesOf(db, c.id)).toHaveLength(1);
  });

  test("una campaña cancelada libera la plantilla", async () => {
    await insertContact(db);
    const first = await createCampaign(db);
    await confirm(first);
    await rpc()("cancel_campaign", { p_campaign_id: first });
    expect(await confirm(await createCampaign(db))).toBe(1);
  });

  test("las bajas nunca se encolan", async () => {
    const c = await insertContact(db);
    await rpc()("register_opt_out", { p_phone: c.wa_phone, p_source: "keyword" });
    expect(await confirm(await createCampaign(db))).toBe(0);
  });
});

describe("despacho", () => {
  test("envía, guarda wamid y respeta el tamaño de lote", async () => {
    for (let i = 0; i < 5; i++) await insertContact(db);
    await confirm(await createCampaign(db));
    const send = okSender();
    const summary = await dispatch(send, 3);
    expect(summary).toMatchObject({ claimed: 3, sent: 3 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toMatchObject({ template: "gen12_energia", language: "es_AR", variables: ["Octavio", "369 Seguridad y Energía"] });
    const r = await one<{ sent: number; queued: number }>(
      db,
      `select count(*) filter (where status = 'sent' and wamid is not null)::int as sent,
              count(*) filter (where status = 'queued')::int as queued from public.messages`,
    );
    expect(r).toEqual({ sent: 3, queued: 2 });
  });

  test("tope diario: no supera los destinatarios únicos de 24 h", async () => {
    await db.query(`update public.app_settings set daily_cap = 4`);
    for (let i = 0; i < 6; i++) await insertContact(db);
    await confirm(await createCampaign(db));
    expect((await dispatch(okSender(), 3)).sent).toBe(3);
    expect((await dispatch(okSender(), 3)).sent).toBe(1); // lote parcial por cupo
    expect((await dispatch(okSender(), 3)).claimed).toBe(0); // tope alcanzado
    await db.query(`update public.app_settings set daily_cap = 6`);
    expect((await dispatch(okSender(), 3)).sent).toBe(2);
  });

  test("fuera de la ventana horaria no envía", async () => {
    await db.query(`update public.app_settings set send_window_start = '00:00', send_window_end = '00:00'`);
    await insertContact(db);
    await confirm(await createCampaign(db));
    expect((await dispatch(okSender())).claimed).toBe(0);
  });

  test("dos claims seguidos nunca toman el mismo envío", async () => {
    for (let i = 0; i < 4; i++) await insertContact(db);
    await confirm(await createCampaign(db));
    const a = await rpc()<{ message_id: string }[]>("claim_messages", { p_limit: 2 });
    const b = await rpc()<{ message_id: string }[]>("claim_messages", { p_limit: 10 });
    const ids = [...a, ...b].map((m) => m.message_id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  test("baja entre el encolado y el envío: se cancela", async () => {
    const c = await insertContact(db);
    await confirm(await createCampaign(db));
    await db.query(`insert into public.opt_outs (wa_phone, source) values ($1, 'keyword')`, [c.wa_phone]);
    const send = okSender();
    await dispatch(send);
    expect(send).not.toHaveBeenCalled();
    expect((await messagesOf(db, c.id))[0].status).toBe("cancelled");
  });

  test("envío colgado más de 15 min queda 'unknown' y no se reintenta", async () => {
    const c = await insertContact(db);
    await confirm(await createCampaign(db));
    await db.query(`update public.messages set status = 'sending', locked_at = now() - interval '20 minutes'`);
    const send = okSender();
    await dispatch(send);
    expect(send).not.toHaveBeenCalled();
    expect((await messagesOf(db, c.id))[0].status).toBe("unknown");
  });

  test("131048 pausa la campaña y devuelve el mensaje a la cola", async () => {
    for (let i = 0; i < 3; i++) await insertContact(db);
    const campaign = await createCampaign(db);
    await confirm(campaign);
    const send = vi.fn(async (): Promise<SendResult> => ({
      ok: false,
      error: { httpStatus: 400, code: 131048, title: "Spam rate limit hit", message: "Spam rate limit hit" },
    }));
    const summary = await dispatch(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary.paused).toEqual([campaign]);
    const ca = await one<{ status: string; pause_error_code: string; pause_reason: string }>(
      db, `select status, pause_error_code, pause_reason from public.campaigns where id = $1`, [campaign]);
    expect(ca).toMatchObject({ status: "paused", pause_error_code: "131048" });
    expect(ca.pause_reason).toContain("Spam rate limit");
    const r = await one(db, `select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'failed')::int as failed from public.messages`);
    expect(r).toEqual({ queued: 3, failed: 0 });

    await rpc()("resume_campaign", { p_campaign_id: campaign });
    expect(await one(db, `select status from public.campaigns where id = $1`, [campaign])).toEqual({ status: "sending" });
  });

  test("401 pausa la campaña y frena todos los envíos", async () => {
    await insertContact(db);
    await insertContact(db, { rubro: "Salud", template_name: "gen12_salud" });
    const a = await createCampaign(db, { rubros: ["Energía, oil & gas y minería"] });
    const b = await createCampaign(db, { rubros: ["Salud"] });
    await confirm(a);
    await confirm(b);
    const summary = await dispatch(async () => ({ ok: false, error: { httpStatus: 401, code: 190, message: "Invalid OAuth access token" } }));
    expect(summary.halted).toBe(true);
    expect(await one(db, `select sending_halted from public.app_settings`)).toEqual({ sending_halted: true });
    expect((await dispatch(okSender())).claimed).toBe(0);
  });

  test("plantilla pausada por Meta (132015) pausa la campaña y la plantilla", async () => {
    await insertContact(db);
    await confirm(await createCampaign(db));
    await dispatch(async () => ({ ok: false, error: { httpStatus: 400, code: 132015, message: "Template is paused" } }));
    expect(await one(db, `select status from public.templates where name = 'gen12_energia'`)).toEqual({ status: "paused" });
  });

  test("error 500: reintenta con espera y a los 3 intentos queda fallido", async () => {
    const c = await insertContact(db);
    await confirm(await createCampaign(db));
    const fail500 = async (): Promise<SendResult> => ({ ok: false, error: { httpStatus: 500, message: "Internal" } });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await dispatch(fail500);
      const [m] = await messagesOf(db, c.id);
      expect(m.attempts).toBe(attempt);
      expect(m.status).toBe(attempt < 3 ? "queued" : "failed");
      await db.query(`update public.messages set next_attempt_at = now()`);
    }
  });

  test("número sin WhatsApp: fallido sin reintentos", async () => {
    const c = await insertContact(db);
    await confirm(await createCampaign(db));
    await dispatch(async () => ({ ok: false, error: { httpStatus: 400, code: 131026, message: "Message undeliverable" } }));
    const [m] = await messagesOf(db, c.id);
    expect(m).toMatchObject({ status: "failed", error_code: "131026" });
  });

  test("campaña sin pendientes pasa a completada", async () => {
    await insertContact(db);
    const campaign = await createCampaign(db);
    await confirm(campaign);
    await dispatch(okSender());
    await rpc()("sweep_dispatch");
    expect(await one(db, `select status from public.campaigns where id = $1`, [campaign])).toEqual({ status: "completed" });
  });

  test("clasificación de errores", () => {
    expect(classifySendError({ httpStatus: 403, message: "" })).toBe("halt");
    for (const code of [131048, 131049, 131056, 130429]) {
      expect(classifySendError({ httpStatus: 400, code, message: "" })).toBe("pause");
    }
    expect(classifySendError({ httpStatus: 0, message: "timeout" })).toBe("retry");
    expect(classifySendError({ httpStatus: 400, code: 100, message: "" })).toBe("fail");
  });
});
