import { env } from "@/lib/env";
import { supabaseRpc } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/timing-safe";

export const maxDuration = 60;

/** Lo llama pg_cron una vez por día vía pg_net. Idempotente. */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request, env.cronSecret())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const enqueued = await supabaseRpc(createAdminClient())<number>("enqueue_follow_ups");
  return Response.json({ enqueued });
}
