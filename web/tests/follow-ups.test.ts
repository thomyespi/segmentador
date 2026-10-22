import { beforeEach, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { isAuthorizedCron } from "@/lib/timing-safe";
import { createTestDb } from "./helpers/db";
import { createCampaign, insertContact, messagesOf, one, pgliteRpc } from "./helpers/fixtures";

let db: PGlite;
const rpc = () => pgliteRpc(db);
let seq = 0;

beforeEach(async () => {
  db = await createTestDb();
  await db.query(`update public.templates set status = 'approved' where name = 'gen12_seguimiento_1'`);
});

type Sent = { delivered?: string; read?: string; failed?: boolean };

/** Campaña con un contacto ya enviado y una regla. Los tiempos son intervalos hacia atrás ("3 days"). */
async function setup(rule: { trigger: string; days: number }, sent: Sent, maxFollowUps = 1) {
  const contact = await insertContact(db);
  const campaign = await createCampaign(db, { maxFollowUps });
  await rpc()("enqueue_campaign", { p_campaign_id: campaign });
  const [m] = await messagesOf(db, contact.id);
  await db.query(
    `update public.messages set status = $2, wamid = $3, sent_at = now() - interval '10 days',
       delivered_at = now() - $4::interval, read_at = now() - $5::interval,
       failed_at = case when $6 then now() end
     where id = $1`,
    [m.id, sent.failed ? "failed" : sent.read ? "read" : "delivered", `wamid.F${++seq}`, sent.delivered ?? null, sent.read ?? null, !!sent.failed],
  );
  const template = await one<{ id: string }>(db, `select id from public.templates where name = 'gen12_seguimiento_1'`);
  await db.query(
    `insert into public.follow_up_rules (campaign_id, trigger, delay_days, template_id) values ($1, $2, $3, $4)`,
    [campaign, rule.trigger, rule.days, template.id],
  );
  return { contact, campaign, originalId: m.id as string };
}

const followUps = async (contactId: string) => (await messagesOf(db, contactId)).filter((m) => m.kind === "follow_up");

describe("enqueue_follow_ups", () => {
  test("leído y sin respuesta a los N días → encola el seguimiento con las variables", async () => {
    const { contact, originalId } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "3 days 1 hour" });
    expect(await rpc()("enqueue_follow_ups")).toBe(1);
    const [f] = await followUps(contact.id);
    expect(f).toMatchObject({
      template_name: "gen12_seguimiento_1", status: "queued", parent_message_id: originalId,
      variables: ["Octavio", "369 Seguridad y Energía"],
    });
  });

  test("todavía no pasaron los días", async () => {
    const { contact } = await setup({ trigger: "delivered_not_read", days: 4 }, { delivered: "2 days" });
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
    expect(await followUps(contact.id)).toHaveLength(0);
  });

  test("entregado pero no leído a los N días", async () => {
    const { contact } = await setup({ trigger: "delivered_not_read", days: 4 }, { delivered: "5 days" });
    expect(await rpc()("enqueue_follow_ups")).toBe(1);
    expect(await followUps(contact.id)).toHaveLength(1);
  });

  test("leído no dispara la regla de no leídos", async () => {
    await setup({ trigger: "delivered_not_read", days: 4 }, { delivered: "5 days", read: "5 days" });
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
  });

  test("contacto que respondió: no hay seguimiento", async () => {
    const { contact } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "4 days" });
    await db.query(
      `insert into public.inbound_messages (wa_message_id, contact_id, from_phone, type, text, received_at)
       values ('wamid.R', $1, $2, 'text', 'Mandame info', now() - interval '3 days')`,
      [contact.id, contact.wa_phone],
    );
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
  });

  test("contacto dado de baja: no hay seguimiento", async () => {
    const { contact } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "4 days" });
    await rpc()("register_opt_out", { p_phone: contact.wa_phone, p_source: "button" });
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
  });

  test("envío original fallido: no hay seguimiento", async () => {
    await setup({ trigger: "delivered_not_read", days: 1 }, { delivered: "5 days", failed: true });
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
  });

  test("tope de 1 seguimiento por contacto", async () => {
    const { contact, campaign } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "9 days", read: "9 days" });
    expect(await rpc()("enqueue_follow_ups")).toBe(1);
    // El seguimiento se envió y se leyó hace mucho; una segunda regla igual no debe disparar.
    await db.query(
      `update public.messages set status = 'read', wamid = 'wamid.FU', sent_at = now() - interval '8 days',
         delivered_at = now() - interval '8 days', read_at = now() - interval '8 days' where kind = 'follow_up'`,
    );
    const template = await one<{ id: string }>(db, `select id from public.templates where name = 'gen12_seguimiento_1'`);
    await db.query(
      `insert into public.follow_up_rules (campaign_id, step, trigger, delay_days, template_id) values ($1, 2, 'read_no_reply', 3, $2)`,
      [campaign, template.id],
    );
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
    expect(await followUps(contact.id)).toHaveLength(1);
  });

  test("con máximo 2, la segunda regla se evalúa sobre el último seguimiento", async () => {
    const { contact, campaign } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "9 days", read: "9 days" }, 2);
    await rpc()("enqueue_follow_ups");
    await db.query(
      `update public.messages set status = 'read', wamid = 'wamid.FU2', sent_at = now() - interval '5 days',
         delivered_at = now() - interval '5 days', read_at = now() - interval '5 days' where kind = 'follow_up'`,
    );
    const template = await one<{ id: string }>(db, `select id from public.templates where name = 'gen12_seguimiento_1'`);
    await db.query(
      `insert into public.follow_up_rules (campaign_id, step, trigger, delay_days, template_id) values ($1, 2, 'read_no_reply', 7, $2)`,
      [campaign, template.id],
    );
    expect(await rpc()("enqueue_follow_ups")).toBe(0); // el seguimiento se leyó hace 5 días, la regla pide 7
    await db.query(`update public.messages set read_at = now() - interval '8 days' where kind = 'follow_up'`);
    expect(await rpc()("enqueue_follow_ups")).toBe(1);
    expect(await followUps(contact.id)).toHaveLength(2);
  });

  test("doble ejecución el mismo día no duplica", async () => {
    const { contact } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "4 days" });
    await rpc()("enqueue_follow_ups");
    await rpc()("enqueue_follow_ups");
    expect(await followUps(contact.id)).toHaveLength(1);
  });

  test("plantilla no aprobada: no encola", async () => {
    await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "4 days" });
    await db.query(`update public.templates set status = 'paused' where name = 'gen12_seguimiento_1'`);
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
  });

  test("regla desactivada: no encola", async () => {
    await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "4 days" });
    await db.query(`update public.follow_up_rules set active = false`);
    expect(await rpc()("enqueue_follow_ups")).toBe(0);
  });

  test("los seguimientos se despachan aunque la campaña esté completada y comparten el tope", async () => {
    const { campaign } = await setup({ trigger: "read_no_reply", days: 3 }, { delivered: "4 days", read: "4 days" });
    await rpc()("sweep_dispatch");
    expect(await one(db, `select status from public.campaigns where id = $1`, [campaign])).toEqual({ status: "completed" });
    await rpc()("enqueue_follow_ups");
    await db.query(`update public.app_settings set daily_cap = 0`);
    expect(await rpc()<unknown[]>("claim_messages", { p_limit: 10 })).toHaveLength(0);
    await db.query(`update public.app_settings set daily_cap = 10`);
    expect(await rpc()<unknown[]>("claim_messages", { p_limit: 10 })).toHaveLength(1);
  });
});

describe("autorización de cron", () => {
  const req = (auth?: string) =>
    new Request("https://app.test/api/cron/follow-ups", { method: "POST", headers: auth ? { Authorization: auth } : {} });

  test("sin secreto o con secreto incorrecto → rechazado", () => {
    expect(isAuthorizedCron(req(), "s3cret")).toBe(false);
    expect(isAuthorizedCron(req("Bearer otro"), "s3cret")).toBe(false);
    expect(isAuthorizedCron(req("Bearer s3cret"), undefined)).toBe(false);
  });

  test("secreto correcto → autorizado", () => {
    expect(isAuthorizedCron(req("Bearer s3cret"), "s3cret")).toBe(true);
  });
});
