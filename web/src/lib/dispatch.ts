import type { SendResult, SendTemplateInput } from "./whatsapp/client";
import { classifySendError, describeSendError, nextRetryAt } from "./whatsapp/errors";

export type ClaimedMessage = {
  message_id: string;
  campaign_id: string;
  kind: string;
  wa_phone: string;
  template_name: string;
  language: string;
  variables: string[];
  attempts: number;
};

export type MessageError = { code: string; title?: string; details: string };

export interface DispatchStore {
  sweep(): Promise<void>;
  getBatchSize(): Promise<number>;
  claim(limit: number): Promise<ClaimedMessage[]>;
  isOptedOut(phone: string): Promise<boolean>;
  cancel(messageId: string): Promise<void>;
  recordSuccess(messageId: string, wamid: string): Promise<void>;
  /** Vuelve a la cola para otro intento en `at` (cuenta como intento hecho). */
  retryLater(messageId: string, at: Date, error: MessageError): Promise<void>;
  /** Vuelve a la cola sin contar el intento (no llegó a mandarse o lo frenó un límite). */
  release(messageIds: string[], error?: MessageError): Promise<void>;
  fail(messageId: string, error: MessageError): Promise<void>;
  pauseCampaign(campaignId: string, code: string, reason: string): Promise<void>;
  haltSending(reason: string): Promise<void>;
  markTemplate(templateName: string, status: "paused" | "disabled", reason: string): Promise<void>;
}

export type DispatchDeps = {
  store: DispatchStore;
  send: (input: SendTemplateInput) => Promise<SendResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Pausa entre envíos. */
  pacingMs?: number;
  /** Corta antes del timeout de la función serverless. */
  budgetMs?: number;
};

export type DispatchSummary = {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  cancelled: number;
  released: number;
  paused: string[];
  halted: boolean;
};

export async function runDispatch(deps: DispatchDeps): Promise<DispatchSummary> {
  const { store, send } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const pacingMs = deps.pacingMs ?? 300;
  const budgetMs = deps.budgetMs ?? 45_000;
  const startedAt = now().getTime();

  const summary: DispatchSummary = {
    claimed: 0, sent: 0, failed: 0, retried: 0, cancelled: 0, released: 0, paused: [], halted: false,
  };

  await store.sweep();
  const batch = await store.claim(await store.getBatchSize());
  summary.claimed = batch.length;

  const pausedCampaigns = new Set<string>();
  const toRelease: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const msg = batch[i];

    if (summary.halted || pausedCampaigns.has(msg.campaign_id) || now().getTime() - startedAt > budgetMs) {
      toRelease.push(msg.message_id);
      continue;
    }

    // La baja pudo llegar entre el claim y este envío.
    if (await store.isOptedOut(msg.wa_phone)) {
      await store.cancel(msg.message_id);
      summary.cancelled++;
      continue;
    }

    const result = await send({
      to: msg.wa_phone,
      template: msg.template_name,
      language: msg.language,
      variables: msg.variables,
    });

    if (result.ok) {
      await store.recordSuccess(msg.message_id, result.wamid);
      summary.sent++;
    } else {
      const error: MessageError = {
        code: result.error.code !== undefined ? String(result.error.code) : `http_${result.error.httpStatus}`,
        title: result.error.title,
        details: describeSendError(result.error),
      };
      const action = classifySendError(result.error);

      if (action === "halt" || action === "pause" || action === "pause_template") {
        await store.release([msg.message_id], error);
        summary.released++;
        await store.pauseCampaign(msg.campaign_id, error.code, error.details);
        pausedCampaigns.add(msg.campaign_id);
        summary.paused.push(msg.campaign_id);
        // 132015 = plantilla pausada, 132016 = deshabilitada, 132001 = no existe en Meta.
        // El resto de los 132xxx son errores de parámetros: se pausa la campaña pero la plantilla sigue.
        if (action === "pause_template" && result.error.code === 132015) {
          await store.markTemplate(msg.template_name, "paused", error.details);
        } else if (action === "pause_template" && (result.error.code === 132016 || result.error.code === 132001)) {
          await store.markTemplate(msg.template_name, "disabled", error.details);
        }
        if (action === "halt") {
          await store.haltSending(error.details);
          summary.halted = true;
        }
      } else if (action === "retry") {
        const at = nextRetryAt(msg.attempts, now());
        if (at) {
          await store.retryLater(msg.message_id, at, error);
          summary.retried++;
        } else {
          await store.fail(msg.message_id, error);
          summary.failed++;
        }
      } else {
        await store.fail(msg.message_id, error);
        summary.failed++;
      }
    }

    if (i < batch.length - 1) await sleep(pacingMs);
  }

  if (toRelease.length > 0) {
    await store.release(toRelease);
    summary.released += toRelease.length;
  }
  return summary;
}
