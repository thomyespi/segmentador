export const CAMPAIGN_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-slate-100 text-slate-700" },
  sending: { label: "Enviando", className: "bg-emerald-100 text-emerald-800" },
  paused: { label: "Pausada", className: "bg-amber-100 text-amber-800" },
  completed: { label: "Completada", className: "bg-sky-100 text-sky-800" },
  cancelled: { label: "Cancelada", className: "bg-slate-200 text-slate-500" },
};

export const MESSAGE_STATUS: Record<string, string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Fallido",
  cancelled: "Cancelado",
  unknown: "Incierto",
};

export const EXCLUSION: Record<string, string> = {
  enviar_no: "Enviar = NO",
  baja: "Pidió la baja",
  sin_plantilla: "Sin plantilla para su rubro",
  plantilla_no_aprobada: "Plantilla no aprobada",
  sin_variables: "Falta nombre o empresa",
  ya_recibida: "Ya recibió esa plantilla",
};

export const TRIGGERS: Record<string, string> = {
  read_no_reply: "Leído y sin respuesta",
  delivered_not_read: "Entregado pero no leído",
};

export const INTENT: Record<string, string> = {
  interested: "Me interesa",
  opt_out: "Baja",
  other: "Respuesta",
};

export const TEMPLATE_STATUS: Record<string, string> = {
  approved: "Aprobada",
  pending: "Pendiente",
  rejected: "Rechazada",
  paused: "Pausada",
  disabled: "Deshabilitada",
};

export const READ_NOTE =
  "Meta solo informa “leído” si el destinatario tiene activadas las confirmaciones de lectura: es un mínimo, no el total.";

const dateTime = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDate(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

export function formatUsd(value: number | string | null | undefined): string {
  return `US$ ${Number(value ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
