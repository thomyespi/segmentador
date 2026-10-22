const WA_PHONE = /^549\d{10}$/;

export function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Número de la base: solo dígitos y formato 549 + 10 dígitos. */
export function normalizeWaPhone(value: unknown): string | null {
  const digits = digitsOnly(value);
  return WA_PHONE.test(digits) ? digits : null;
}

/**
 * Número que informa Meta (`from` / `wa_id`). Para celulares argentinos suele venir como 549...,
 * pero se acepta también 54 + 10 dígitos (sin el 9) para no perder respuestas.
 */
export function normalizeInboundPhone(value: unknown): string {
  const digits = digitsOnly(value);
  if (/^54\d{10}$/.test(digits)) return `549${digits.slice(2)}`;
  return digits;
}
