import { beforeEach, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { detectIntent } from "@/lib/intent";
import { handleNotification, handleVerification } from "@/lib/webhook/handler";
import { rpcWebhookStore } from "@/lib/webhook/process";
import { signPayload } from "@/lib/webhook/signature";
import { createTestDb } from "./helpers/db";
import { createCampaign, insertContact, messagesOf, one, pgliteRpc } from "./helpers/fixtures";

const APP_SECRET = "test-app-secret";
let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
});

function post(body: unknown, signature?: string | null) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = signature === undefined ? signPayload(raw, APP_SECRET) : signature;
  if (sig !== null) headers["X-Hub-Signature-256"] = sig;
  const request = new Request("https://app.test/api/webhooks/whatsapp", { method: "POST", headers, body: raw });
  return handleNotification(request, { appSecret: APP_SECRET, store: () => rpcWebhookStore(pgliteRpc(db)) });
}

function envelope(value: Record<string, unknown>, field = "messages") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", ...value } }] }],
  };
}

const ts = (date: string) => String(Math.floor(new Date(date).getTime() / 1000));

function status(wamid: string, value: string, at: string, extra: Record<string, unknown> = {}) {
  return { id: wamid, status: value, timestamp: ts(at), recipient_id: "5492991234567", ...extra };
}

/** Contacto con un envío de campaña ya aceptado por Meta (wamid.A). */
async function sentMessage() {
  const contact = await insertContact(db, { wa_phone: "5492991234567" });
  const campaign = await createCampaign(db);
  await pgliteRpc(db)("enqueue_campaign", { p_campaign_id: campaign });
  const [m] = await pgliteRpc(db)<{ message_id: string }[]>("claim_messages", { p_limit: 1 });
  await pgliteRpc(db)("record_send_success", { p_message_id: m.message_id, p_wamid: "wamid.A" });
  return { contact, campaign, messageId: m.message_id };
}

describe("verificación GET", () => {
  test("verify token correcto devuelve el challenge", async () => {
    const url = new URL("https://app.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=12345");
    const res = handleVerification(url, "tok");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  test("verify token incorrecto → 403", () => {
    const url = new URL("https://app.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1");
    expect(handleVerification(url, "tok").status).toBe(403);
  });
});

describe("firma X-Hub-Signature-256", () => {
  test("firma inválida → 401 y no se guarda nada", async () => {
    await sentMessage();
    const body = envelope({ statuses: [status("wamid.A", "delivered", "2026-10-20T12:00:00Z")] });
    const res = await post(body, "sha256=" + "0".repeat(64));
    expect(res.status).toBe(401);
    expect(await one(db, `select count(*)::int as n from public.message_events`)).toEqual({ n: 0 });
    expect(await one(db, `select status from public.messages`)).toEqual({ status: "sent" });
  });

  test("firma ausente → 401", async () => {
    const res = await post(envelope({ statuses: [] }), null);
    expect(res.status).toBe(401);
    expect(await one(db, `select count(*)::int as n from public.message_events`)).toEqual({ n: 0 });
  });

  test("firma calculada con otro secreto → 401", async () => {
    const body = envelope({ statuses: [] });
    const res = await post(body, signPayload(JSON.stringify(body), "otro-secreto"));
    expect(res.status).toBe(401);
  });

  test("firma válida → 200 y se registra el evento", async () => {
    await sentMessage();
    const res = await post(envelope({ statuses: [status("wamid.A", "delivered", "2026-10-20T12:00:00Z")] }));
    expect(res.status).toBe(200);
    expect(await one(db, `select count(*)::int as n from public.message_events`)).toEqual({ n: 1 });
  });
});

describe("estados", () => {
  test("desordenados: read antes que delivered, el estado no retrocede", async () => {
    await sentMessage();
    await post(envelope({ statuses: [status("wamid.A", "read", "2026-10-20T12:05:00Z")] }));
    let m = await one<Record<string, unknown>>(db, `select status, delivered_at, read_at from public.messages`);
    expect(m.status).toBe("read");
    expect(m.delivered_at).toEqual(new Date("2026-10-20T12:05:00Z")); // read implica entregado

    await post(envelope({ statuses: [status("wamid.A", "delivered", "2026-10-20T12:01:00Z")] }));
    await post(envelope({ statuses: [status("wamid.A", "sent", "2026-10-20T12:00:00Z")] }));
    m = await one<Record<string, unknown>>(db, `select status, delivered_at, read_at from public.messages`);
    expect(m.status).toBe("read");
    expect(m.read_at).toEqual(new Date("2026-10-20T12:05:00Z"));
    expect(m.delivered_at).toEqual(new Date("2026-10-20T12:01:00Z"));
  });

  test("evento duplicado se ignora", async () => {
    await sentMessage();
    const body = envelope({ statuses: [status("wamid.A", "delivered", "2026-10-20T12:00:00Z")] });
    await post(body);
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await one(db, `select count(*)::int as n from public.message_events`)).toEqual({ n: 1 });
  });

  test("failed guarda código y detalle", async () => {
    await sentMessage();
    await post(envelope({
      statuses: [status("wamid.A", "failed", "2026-10-20T12:00:00Z", {
        errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Receiver is incapable" } }],
      })],
    }));
    const m = await one(db, `select status, error_code, error_title, error_details from public.messages`);
    expect(m).toEqual({
      status: "failed", error_code: "131026", error_title: "Message undeliverable", error_details: "Receiver is incapable",
    });
  });

  test("pricing facturable: guarda el objeto y estima el costo", async () => {
    await db.query(`update public.app_settings set marketing_rate_usd = 0.0618`);
    await sentMessage();
    const pricing = { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" };
    await post(envelope({ statuses: [status("wamid.A", "delivered", "2026-10-20T12:00:00Z", { pricing })] }));
    const m = await one<{ pricing: unknown; estimated_cost: string; pricing_category: string }>(
      db, `select pricing, estimated_cost::text, pricing_category from public.messages`);
    expect(m).toEqual({ pricing, estimated_cost: "0.0618", pricing_category: "marketing" });
  });

  test("status que llega antes que el wamid se aplica al guardarlo", async () => {
    const contact = await insertContact(db, { wa_phone: "5492991234567" });
    await pgliteRpc(db)("enqueue_campaign", { p_campaign_id: await createCampaign(db) });
    await post(envelope({ statuses: [status("wamid.LATE", "delivered", "2026-10-20T12:00:00Z")] }));
    const [m] = await messagesOf(db, contact.id);
    await pgliteRpc(db)("record_send_success", { p_message_id: m.id, p_wamid: "wamid.LATE" });
    expect((await messagesOf(db, contact.id))[0].status).toBe("delivered");
  });
});

describe("respuestas y bajas", () => {
  function buttonReply(text: string, payload: string, id = "wamid.IN1") {
    return envelope({
      contacts: [{ wa_id: "5492991234567", profile: { name: "Octavio" } }],
      messages: [{
        from: "5492991234567", id, timestamp: ts("2026-10-20T13:00:00Z"), type: "button",
        context: { from: "5492990000000", id: "wamid.A" }, button: { text, payload },
      }],
    });
  }

  test("baja por botón 'No, gracias': registra la baja y cancela envíos en cola", async () => {
    const { contact } = await sentMessage();
    // Otro envío en cola para el mismo contacto (otra plantilla).
    const t = await one<{ id: string }>(db, `select id from public.templates where name = 'gen12_general'`);
    const other = await createCampaign(db);
    await db.query(
      `insert into public.messages (campaign_id, contact_id, template_id, kind) values ($1, $2, $3, 'campaign')`,
      [other, contact.id, t.id],
    );

    const res = await post(buttonReply("No, gracias", "NO_GRACIAS"));
    expect(res.status).toBe(200);

    expect(await one(db, `select source from public.opt_outs where wa_phone = '5492991234567'`)).toEqual({ source: "button" });
    const c = await one<{ opted_out_at: Date | null }>(db, `select opted_out_at from public.contacts`);
    expect(c.opted_out_at).toEqual(new Date("2026-10-20T13:00:00Z"));
    const queued = await one(db, `select status from public.messages where campaign_id = $1`, [other]);
    expect(queued).toEqual({ status: "cancelled" });
    const inbound = await one(db, `select type, text, button_payload, intent from public.inbound_messages`);
    expect(inbound).toEqual({ type: "button", text: "No, gracias", button_payload: "NO_GRACIAS", intent: "opt_out" });
  });

  test("botón 'Me interesa' queda asociado al envío como interesado", async () => {
    const { messageId } = await sentMessage();
    await post(buttonReply("Me interesa", "ME_INTERESA"));
    const i = await one(db, `select message_id, intent from public.inbound_messages`);
    expect(i).toEqual({ message_id: messageId, intent: "interested" });
    expect(await one(db, `select count(*)::int as n from public.opt_outs`)).toEqual({ n: 0 });
  });

  test("texto libre sin contexto se asocia al último envío", async () => {
    const { messageId } = await sentMessage();
    await post(envelope({
      messages: [{ from: "5492991234567", id: "wamid.IN2", timestamp: ts("2026-10-20T13:00:00Z"), type: "text", text: { body: "¿Cuánto sale una web?" } }],
    }));
    expect(await one(db, `select message_id, text, intent from public.inbound_messages`)).toEqual({
      message_id: messageId, text: "¿Cuánto sale una web?", intent: "other",
    });
  });

  test("baja por texto", async () => {
    await sentMessage();
    await post(envelope({
      messages: [{ from: "5492991234567", id: "wamid.IN3", timestamp: ts("2026-10-20T13:00:00Z"), type: "text", text: { body: "baja por favor" } }],
    }));
    expect(await one(db, `select source from public.opt_outs`)).toEqual({ source: "keyword" });
  });

  test("mensaje entrante duplicado se registra una vez", async () => {
    await sentMessage();
    await post(buttonReply("Me interesa", "ME_INTERESA"));
    await post(buttonReply("Me interesa", "ME_INTERESA"));
    expect(await one(db, `select count(*)::int as n from public.inbound_messages`)).toEqual({ n: 1 });
  });

  test("detección de intención", () => {
    expect(detectIntent({ text: "BAJA" })).toBe("opt_out");
    expect(detectIntent({ text: "Quiero darme de bája" })).toBe("opt_out");
    expect(detectIntent({ text: "no, gracias!" })).toBe("opt_out");
    expect(detectIntent({ text: "Trabajamos en Bahía Blanca" })).toBe("other");
    expect(detectIntent({ text: "hay que bajar costos" })).toBe("other");
    expect(detectIntent({ text: "Me interesa" })).toBe("interested");
  });
});

describe("plantillas", () => {
  test("plantilla pausada por Meta pausa las campañas que la usan", async () => {
    await insertContact(db);
    const campaign = await createCampaign(db);
    await pgliteRpc(db)("enqueue_campaign", { p_campaign_id: campaign });
    await post(envelope({ event: "PAUSED", message_template_name: "gen12_energia", reason: "LOW_QUALITY" }, "message_template_status_update"));
    expect(await one(db, `select status from public.templates where name = 'gen12_energia'`)).toEqual({ status: "paused" });
    const ca = await one<{ status: string; pause_reason: string }>(db, `select status, pause_reason from public.campaigns`);
    expect(ca.status).toBe("paused");
    expect(ca.pause_reason).toContain("PAUSED");
  });
});
