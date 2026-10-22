import { createHmac } from "node:crypto";
import { safeEqual } from "../timing-safe";

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(cuerpo crudo, app secret) en hex. */
export function signPayload(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  return safeEqual(header, signPayload(rawBody, appSecret));
}
