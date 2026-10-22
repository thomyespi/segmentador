import { env } from "@/lib/env";
import { supabaseRpc } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleNotification, handleVerification } from "@/lib/webhook/handler";
import { rpcWebhookStore } from "@/lib/webhook/process";

export const maxDuration = 30;

/** Verificación del webhook desde la app de Meta. */
export function GET(request: Request) {
  return handleVerification(new URL(request.url), env.waVerifyToken());
}

/** Statuses, mensajes entrantes y cambios de plantillas. */
export function POST(request: Request) {
  return handleNotification(request, {
    appSecret: env.waAppSecret(),
    store: () => rpcWebhookStore(supabaseRpc(createAdminClient())),
  });
}
