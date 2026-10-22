import { normalizeText } from "./text";

export type Intent = "interested" | "opt_out" | "other";

/** "BAJA" como palabra completa, sin importar mayúsculas ni acentos. */
const OPT_OUT_WORD = /\bbaja\b/;

function stripPunctuation(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function detectIntent(input: { text?: string | null; payload?: string | null }): Intent {
  const payload = input.payload?.trim().toUpperCase();
  if (payload === "NO_GRACIAS") return "opt_out";
  if (payload === "ME_INTERESA") return "interested";

  const text = stripPunctuation(normalizeText(input.text ?? ""));
  if (text === "no gracias" || OPT_OUT_WORD.test(text)) return "opt_out";
  if (text === "me interesa") return "interested";
  return "other";
}
