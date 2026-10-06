import { z } from "zod";
import { parseEnv } from "@/lib/env";

/** Reads the `role` claim of a legacy JWT API key, if the value is one. */
function jwtRole(key: string): string | undefined {
  const payload = key.split(".")[1];
  if (!key.startsWith("eyJ") || !payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const role: unknown = JSON.parse(json).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Variables the browser and the server both need. Accepts the current
 * `sb_publishable_...` keys and the legacy `anon` JWT, which `supabase status`
 * also prints. Rejects secret and `service_role` keys, which must never reach
 * the browser.
 */
export const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .refine(
      (key) => key.startsWith("sb_publishable_") || jwtRole(key) === "anon",
      "must be a publishable key (sb_publishable_...) or a legacy anon key",
    ),
});

/**
 * Server-only variables. Read them only through `createAdminClient` in
 * `admin.ts`, which is guarded by `server-only`. Accepts `sb_secret_...` keys
 * and the legacy `service_role` JWT.
 */
export const supabaseSecretEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z
    .string()
    .refine(
      (key) => key.startsWith("sb_secret_") || jwtRole(key) === "service_role",
      "must be a secret key (sb_secret_...) or a legacy service_role key",
    ),
});

export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;

/** Whether the public Supabase variables are set at all (not validated). */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Validates and returns the public Supabase variables. Called at first use,
 * so pages that never touch Supabase work without them.
 */
export function getSupabasePublicEnv(): SupabasePublicEnv {
  // Referenced one by one so Next.js inlines them into the browser bundle.
  return parseEnv(supabasePublicEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
