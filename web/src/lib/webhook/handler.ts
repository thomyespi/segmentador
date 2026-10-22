import { processWebhookPayload, type WebhookStore } from "./process";
import { verifySignature } from "./signature";
import { safeEqual } from "../timing-safe";

export function handleVerification(url: URL, verifyToken: string | undefined): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && verifyToken && safeEqual(token, verifyToken)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function handleNotification(
  request: Request,
  deps: { appSecret: string | undefined; store: () => WebhookStore },
): Promise<Response> {
  const rawBody = await request.text();
  if (!deps.appSecret || !verifySignature(rawBody, request.headers.get("x-hub-signature-256"), deps.appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Siempre 200 con firma válida: los errores quedan en message_events y Meta no reintenta en loop.
  const summary = await processWebhookPayload(payload, deps.store());
  return Response.json({ ok: true, ...summary });
}
