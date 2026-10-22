import type { ClaimedMessage, DispatchStore, MessageError } from "./dispatch";
import type { Rpc } from "./rpc";

export function rpcDispatchStore(rpc: Rpc, batchSize: () => Promise<number>): DispatchStore {
  const err = (e: MessageError) => ({
    p_error_code: e.code,
    p_error_title: e.title ?? null,
    p_error_details: e.details,
  });
  return {
    async sweep() {
      await rpc("sweep_dispatch");
      await rpc("reprocess_pending_statuses", { p_wamid: null });
    },
    getBatchSize: batchSize,
    claim: (limit) => rpc<ClaimedMessage[]>("claim_messages", { p_limit: limit }),
    isOptedOut: (phone) => rpc<boolean>("is_opted_out", { p_phone: phone }),
    cancel: (id) => rpc("cancel_message", { p_message_id: id }),
    recordSuccess: (id, wamid) => rpc("record_send_success", { p_message_id: id, p_wamid: wamid }),
    retryLater: (id, at, e) =>
      rpc("retry_message", { p_message_id: id, p_retry_at: at.toISOString(), ...err(e) }),
    release: (ids, e) =>
      rpc("release_messages", {
        p_message_ids: ids,
        p_error_code: e?.code ?? null,
        p_error_title: e?.title ?? null,
        p_error_details: e?.details ?? null,
      }),
    fail: (id, e) => rpc("fail_message", { p_message_id: id, ...err(e) }),
    pauseCampaign: (id, code, reason) =>
      rpc("pause_campaign", { p_campaign_id: id, p_code: code, p_reason: reason }),
    haltSending: (reason) => rpc("halt_sending", { p_reason: reason }),
    markTemplate: (name, status, reason) =>
      rpc("mark_template", { p_name: name, p_status: status, p_reason: reason }),
  };
}
