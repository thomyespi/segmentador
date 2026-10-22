/** Minúsculas y sin acentos, para comparar respuestas escritas a mano. */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
