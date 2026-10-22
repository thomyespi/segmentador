import { dispatchBatch } from "@/lib/dispatch-runner";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/timing-safe";

export const maxDuration = 60;

/** Lo llama pg_cron cada 10 minutos vía pg_net (ver migración _cron.sql). */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request, env.cronSecret())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const summary = await dispatchBatch();
  return Response.json(summary);
}
