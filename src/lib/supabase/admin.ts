import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabasePublicEnv, getSupabaseSecretEnv } from "./env";

/**
 * Supabase client with the secret (service role) key. It BYPASSES Row Level
 * Security, so every query must scope data to the right user itself.
 *
 * Use it deliberately and in few places (ADR 0003): server
 * code with no signed-in user, such as background jobs. Never use it to handle
 * a user's request; use the client from `server.ts` instead.
 */
export function createAdminClient() {
  const env = getSupabasePublicEnv();
  const { SUPABASE_SECRET_KEY } = getSupabaseSecretEnv();

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
