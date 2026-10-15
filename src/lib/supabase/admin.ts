import "server-only";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { markAdminClient, type AdminSupabase } from "./admin-brand";
import type { Database } from "./database.types";
import { getSupabasePublicEnv, getSupabaseSecretEnv } from "./env";
import type { SessionSupabase } from "./types";

const noSession = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
};

/**
 * Supabase client with the secret (service role) key. It BYPASSES Row Level
 * Security, so every query must scope data to the right user itself.
 *
 * Use it deliberately and in few places (ADR 0003): server
 * code with no signed-in user, such as background jobs. Never use it to handle
 * a user's request; use the client from `server.ts` instead.
 *
 * The client is marked as `AdminSupabase` (see `admin-brand.ts`), so code
 * that relies on Row Level Security can demand an explicit user.
 */
export function createAdminClient() {
  const env = getSupabasePublicEnv();
  const { SUPABASE_SECRET_KEY } = getSupabaseSecretEnv();

  return markAdminClient(
    createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: noSession,
    }),
  );
}

/**
 * A client signed in as the user, so Row Level Security applies as in a
 * request of theirs. It replaces the user's password: for smoke checks'
 * throwaway Students only, who never sign in themselves. Call it only from
 * `evals/smoke/`, never from app code: lint does not stop other callers.
 */
export async function signInAsUser(
  admin: AdminSupabase,
  userId: string,
): Promise<SessionSupabase> {
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    password,
  });
  if (error) throw new Error(`Setting the password failed: ${error.message}`);
  const env = getSupabasePublicEnv();
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: noSession },
  );
  const signIn = await client.auth.signInWithPassword({
    email: data.user.email!,
    password,
  });
  if (signIn.error)
    throw new Error(`Signing in failed: ${signIn.error.message}`);
  return client as SessionSupabase;
}
