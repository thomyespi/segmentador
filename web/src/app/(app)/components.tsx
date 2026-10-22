import { CAMPAIGN_STATUS, formatDate } from "@/lib/labels";
import type { SendingState } from "@/lib/campaign-data";

export function StatusBadge({ status }: { status: string }) {
  const s = CAMPAIGN_STATUS[status] ?? { label: status, className: "bg-slate-100" };
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${s.className}`}>{s.label}</span>;
}

export function HaltedBanner({ state }: { state: SendingState }) {
  if (!state.halted) return null;
  return (
    <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-semibold">Envíos frenados para todas las campañas</p>
      <p className="mt-1">{state.haltReason}</p>
      <p className="mt-1 text-xs">
        Desde {formatDate(state.haltedAt)}. Revisá el token y el número en Meta y reactivá desde Configuración.
      </p>
    </div>
  );
}

export function PauseNotice(props: { code: string | null; reason: string | null; pausedAt: string | null }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">Pausada{props.code ? ` · ${props.code}` : ""}</p>
      {props.reason && <p className="mt-1 break-words">{props.reason}</p>}
      <p className="mt-1 text-xs">{formatDate(props.pausedAt)}</p>
    </div>
  );
}

export function QuotaBar({ state }: { state: SendingState }) {
  const pct = state.dailyCap > 0 ? Math.min(100, Math.round((state.used / state.dailyCap) * 100)) : 100;
  return (
    <div className="card text-sm">
      <div className="flex items-baseline justify-between">
        <span className="label">Cupo de las últimas 24 h</span>
        <span>
          {state.used} / {state.dailyCap} destinatarios
        </span>
      </div>
      <div className="mt-2 h-2 rounded bg-slate-100">
        <div className="h-2 rounded bg-emerald-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Envíos de {state.windowStart} a {state.windowEnd} h, en lotes de {state.batchSize} cada 10 minutos.
      </p>
    </div>
  );
}
