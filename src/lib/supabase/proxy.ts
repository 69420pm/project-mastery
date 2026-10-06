import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { getSupabasePublicEnv, isSupabaseConfigured } from "./env";

/**
 * Refreshes the Supabase session on every request and writes the updated auth
 * cookies to both the request (for Server Components) and the response (for
 * the browser). Protects no routes: pages, actions and route handlers check
 * the user themselves with `getUser` / `requireUser`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Without Supabase configured (for example a CI build without keys), skip
  // the refresh so pages that do not need auth keep working.
  if (!isSupabaseConfigured()) return response;

  const env = getSupabasePublicEnv();
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Keeps CDNs from caching a response that carries a session.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Do not run code between creating the client and this call. getClaims()
  // validates the JWT and refreshes an expired session; skipping it signs
  // users out at random.
  await supabase.auth.getClaims();

  // Return this exact response: a new one would drop the refreshed cookies.
  return response;
}
