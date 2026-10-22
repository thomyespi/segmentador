import type { SendError } from "./client";

/**
 * - halt: problema de cuenta/token. Pausa la campaña y frena todos los envíos.
 * - pause: límite de Meta. Pausa la campaña y devuelve el mensaje a la cola.
 * - pause_template: la plantilla no se puede usar. Pausa la campaña y devuelve el mensaje a la cola.
 * - retry: error transitorio, se reintenta con espera creciente.
 * - fail: error del destinatario, fallido definitivo.
 */
export type SendErrorAction = "halt" | "pause" | "pause_template" | "retry" | "fail";

const PAUSE_CODES = new Set([131048, 131049, 131056, 130429, 80007, 4]);
const TEMPLATE_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);
const TRANSIENT_CODES = new Set([1, 2, 131000, 131016, 133004]);

export const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAYS_MINUTES = [5, 30, 120];

export function classifySendError(error: SendError): SendErrorAction {
  if (error.httpStatus === 401 || error.httpStatus === 403 || error.code === 190) return "halt";
  if (error.code !== undefined && PAUSE_CODES.has(error.code)) return "pause";
  if (error.code !== undefined && TEMPLATE_CODES.has(error.code)) return "pause_template";
  if (error.httpStatus === 0 || error.httpStatus >= 500) return "retry";
  if (error.code !== undefined && TRANSIENT_CODES.has(error.code)) return "retry";
  if (error.httpStatus === 429) return "pause";
  return "fail";
}

/** Momento del próximo intento, o null si ya se agotaron. `attempts` = intentos ya hechos. */
export function nextRetryAt(attempts: number, now: Date = new Date()): Date | null {
  if (attempts >= MAX_SEND_ATTEMPTS) return null;
  const minutes = RETRY_DELAYS_MINUTES[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MINUTES.at(-1)!;
  return new Date(now.getTime() + minutes * 60_000);
}

export function describeSendError(error: SendError): string {
  const code = error.code !== undefined ? `${error.code}` : `HTTP ${error.httpStatus}`;
  return [code, error.title, error.message, error.details].filter(Boolean).join(" · ");
}
