import "server-only";
import { runDispatch } from "./dispatch";
import { rpcDispatchStore } from "./dispatch-store";
import { env } from "./env";
import { supabaseRpc } from "./rpc";
import { createAdminClient } from "./supabase/admin";
import { sendTemplate } from "./whatsapp/client";

/** Despacha un lote de la cola con la service role. Lo usa /api/cron/dispatch. */
export async function dispatchBatch() {
  const admin = createAdminClient();
  const wa = env.whatsapp();
  return runDispatch({
    store: rpcDispatchStore(supabaseRpc(admin), async () => {
      const { data, error } = await admin.from("app_settings").select("batch_size").single();
      if (error) throw new Error(error.message);
      return data.batch_size as number;
    }),
    send: (input) => sendTemplate(wa, input),
  });
}
