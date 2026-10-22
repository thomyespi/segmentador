/** Reemplaza {{1}}, {{2}}, ... por las variables (base 1). */
export function renderTemplate(body: string, variables: ReadonlyArray<string | null | undefined>): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => variables[Number(n) - 1] ?? match);
}

export type TemplateButton = { type: string; text: string };

/** Payloads que mandamos en los botones de respuesta rápida, en el mismo orden que en Meta. */
export const BUTTON_PAYLOADS = ["ME_INTERESA", "NO_GRACIAS"] as const;
