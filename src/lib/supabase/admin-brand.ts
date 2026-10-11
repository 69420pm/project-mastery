import type { Supabase } from "./types";

/**
 * Marks the admin (service role) client, so code that scopes data by Row
 * Level Security can tell that it has none. Features may import this file;
 * only workflows may import `admin.ts`, which creates the client (ADR 0003).
 */
export const ADMIN_CLIENT: unique symbol = Symbol("admin Supabase client");

/** The admin client: it bypasses Row Level Security, so callers scope data. */
export type AdminSupabase = Supabase & { readonly [ADMIN_CLIENT]: true };

/**
 * A client that is not typed as the admin client, such as the Student's
 * session client. Its type may still have been widened from an admin client,
 * so code that relies on Row Level Security also checks `isAdminClient`.
 */
export type SessionSupabase = Supabase & { readonly [ADMIN_CLIENT]?: never };

/** Marks `client` as the admin client. For `createAdminClient` and tests. */
export function markAdminClient(client: Supabase): AdminSupabase {
  return Object.assign(client, { [ADMIN_CLIENT]: true as const });
}

/** Whether `client` is the admin client, whatever its static type. */
export function isAdminClient(client: Supabase): boolean {
  return (client as Partial<AdminSupabase>)[ADMIN_CLIENT] === true;
}
