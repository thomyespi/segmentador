import { detectIntent, type Intent } from "../intent";
import { normalizeInboundPhone } from "../phone";
import type { Rpc } from "../rpc";

export type InboundRecord = {
  waMessageId: string;
  from: string;
  contextWamid: string | null;
  type: string;
  text: string | null;
  buttonPayload: string | null;
  receivedAt: string;
  intent: Intent;
  raw: unknown;
};

export interface WebhookStore {
  ingestStatus(status: unknown): Promise<string>;
  recordInbound(message: InboundRecord): Promise<string>;
  updateTemplateStatus(name: string, metaStatus: string | null, reason: string | null, quality: string | null): Promise<void>;
  recordOther(change: unknown): Promise<void>;
  recordError(payload: unknown, error: string): Promise<void>;
}

export function rpcWebhookStore(rpc: Rpc): WebhookStore {
  return {
    ingestStatus: (status) => rpc<string>("ingest_status", { p_status: status }),
    recordInbound: (m) =>
      rpc<string>("record_inbound", {
        p_wa_message_id: m.waMessageId,
        p_from: m.from,
        p_context_wamid: m.contextWamid,
        p_type: m.type,
        p_text: m.text,
        p_button_payload: m.buttonPayload,
        p_received_at: m.receivedAt,
        p_intent: m.intent,
        p_raw: m.raw,
      }),
    updateTemplateStatus: async (name, metaStatus, reason, quality) => {
      await rpc("update_template_status", {
        p_name: name, p_meta_status: metaStatus, p_reason: reason, p_quality: quality,
      });
    },
    recordOther: async (change) => {
      await rpc("record_webhook_other", { p_payload: change });
    },
    recordError: async (payload, error) => {
      await rpc("record_webhook_error", { p_payload: payload, p_error: error });
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- payloads de Meta sin tipar */
export function parseInbound(message: any): InboundRecord {
  let text: string | null = null;
  let buttonPayload: string | null = null;

  switch (message.type) {
    case "text":
      text = message.text?.body ?? null;
      break;
    case "button": // respuesta rápida de una plantilla
      text = message.button?.text ?? null;
      buttonPayload = message.button?.payload ?? null;
      break;
    case "interactive": {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      text = reply?.title ?? null;
      buttonPayload = reply?.id ?? null;
      break;
    }
    default:
      text = message[message.type]?.caption ?? null;
  }

  return {
    waMessageId: message.id,
    from: normalizeInboundPhone(message.from),
    contextWamid: message.context?.id ?? null,
    type: message.type ?? "unknown",
    text,
    buttonPayload,
    receivedAt: new Date(Number(message.timestamp) * 1000).toISOString(),
    intent: detectIntent({ text, payload: buttonPayload }),
    raw: message,
  };
}

export type WebhookSummary = { statuses: number; inbound: number; templates: number; other: number; errors: number };

/** Procesa un payload ya autenticado. Un evento que falla no corta el resto: queda registrado. */
export async function processWebhookPayload(payload: any, store: WebhookStore): Promise<WebhookSummary> {
  const summary: WebhookSummary = { statuses: 0, inbound: 0, templates: 0, other: 0, errors: 0 };

  const attempt = async (data: unknown, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (err) {
      summary.errors++;
      const message = err instanceof Error ? err.message : String(err);
      await store.recordError(data, message).catch(() => undefined);
      return false;
    }
  };

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};

      if (change?.field === "messages") {
        for (const status of value.statuses ?? []) {
          if (await attempt(status, () => store.ingestStatus(status))) summary.statuses++;
        }
        for (const message of value.messages ?? []) {
          if (await attempt(message, () => store.recordInbound(parseInbound(message)))) summary.inbound++;
        }
      } else if (change?.field === "message_template_status_update") {
        const ok = await attempt(change, () =>
          store.updateTemplateStatus(value.message_template_name, value.event ?? null, value.reason ?? null, null),
        );
        if (ok) summary.templates++;
      } else if (change?.field === "message_template_quality_update") {
        const ok = await attempt(change, () =>
          store.updateTemplateStatus(value.message_template_name, null, null, value.new_quality_score ?? null),
        );
        if (ok) summary.templates++;
      } else {
        if (await attempt(change, () => store.recordOther(change))) summary.other++;
      }
    }
  }
  return summary;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
