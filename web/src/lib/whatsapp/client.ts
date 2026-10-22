import { BUTTON_PAYLOADS } from "../templates";

export type WhatsAppConfig = {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
};

export type SendTemplateInput = {
  to: string;
  template: string;
  language: string;
  variables: string[];
};

export type SendError = {
  httpStatus: number; // 0 = error de red o timeout
  code?: number;
  subcode?: number;
  title?: string;
  message: string;
  details?: string;
};

export type SendResult = { ok: true; wamid: string } | { ok: false; error: SendError };

export function buildTemplatePayload(input: SendTemplateInput) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: input.template,
      language: { code: input.language },
      components: [
        { type: "body", parameters: input.variables.map((text) => ({ type: "text", text })) },
        ...BUTTON_PAYLOADS.map((payload, index) => ({
          type: "button",
          sub_type: "quick_reply",
          index: String(index),
          parameters: [{ type: "payload", payload }],
        })),
      ],
    },
  };
}

export async function sendTemplate(
  config: WhatsAppConfig,
  input: SendTemplateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildTemplatePayload(input)),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, error: { httpStatus: 0, message: err instanceof Error ? err.message : String(err) } };
  }

  const data = await response.json().catch(() => null);
  const wamid: string | undefined = data?.messages?.[0]?.id;
  if (response.ok && wamid) return { ok: true, wamid };

  const error = data?.error ?? {};
  return {
    ok: false,
    error: {
      httpStatus: response.status,
      code: typeof error.code === "number" ? error.code : undefined,
      subcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
      title: error.error_user_title ?? error.type,
      message: error.message ?? `HTTP ${response.status}`,
      details: error.error_data?.details ?? error.error_user_msg,
    },
  };
}
