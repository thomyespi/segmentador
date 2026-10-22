import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  whatsapp: () => ({
    token: required("WA_TOKEN"),
    phoneNumberId: required("WA_PHONE_NUMBER_ID"),
    apiVersion: required("WA_API_VERSION"),
  }),
  // Pueden faltar: las rutas responden 401/403 en vez de fallar.
  waAppSecret: () => process.env.WA_APP_SECRET,
  waVerifyToken: () => process.env.WA_VERIFY_TOKEN,
  cronSecret: () => process.env.CRON_SECRET,
};
