import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabasePublicEnv } from "./env";

/**
 * Supabase client for Client Components. Runs as the signed-in user, so Row
 * Level Security applies. In the browser, `@supabase/ssr` returns one shared
 * instance.
 */
export function createClient() {
  const env = getSupabasePublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
