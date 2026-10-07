import { spawn } from "node:child_process";
import postgres from "postgres";
import { AgentError, BIN, ROOT, supabaseEnv } from "./config";
import { PERSONA_PASSWORD, PERSONAS, sqlIdentity } from "./personas";

export async function isSupabaseUp() {
  const { url, publishableKey } = supabaseEnv();
  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Runs a Supabase CLI command, returning its output only when it fails. */
function supabaseCli(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(BIN("supabase"), args, { cwd: ROOT });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const tail = output.trim().split("\n").slice(-15).join("\n");
      const hint = /permission denied.*docker\.sock/i.test(output)
        ? "\nThis shell is not in the docker group yet: start a new login shell (or restart Claude Code), or run `newgrp docker`."
        : "";
      reject(
        new AgentError(`supabase ${args.join(" ")} failed:\n${tail}${hint}`),
      );
    });
  });
}

export const startSupabase = () => supabaseCli(["start"]);
export const resetDatabase = () => supabaseCli(["db", "reset", "--local"]);

type AuthUser = { id: string; email?: string };

async function adminFetch(pathname: string, init: RequestInit = {}) {
  const { url, secretKey } = supabaseEnv();
  const response = await fetch(`${url}/auth/v1/admin${pathname}`, {
    ...init,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new AgentError(
      `Auth admin ${pathname}: ${response.status} ${await response.text()}`,
    );
  }
  return response.json() as Promise<unknown>;
}

/** Creates the test users that do not exist yet. */
export async function ensurePersonas() {
  const { users } = (await adminFetch("/users?per_page=1000")) as {
    users: AuthUser[];
  };
  const existing = new Set(users.map((user) => user.email));
  for (const { email, displayName } of Object.values(PERSONAS)) {
    if (existing.has(email)) continue;
    await adminFetch("/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: PERSONA_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      }),
    });
  }
}

type Row = Record<string, unknown>;
type Result = Row[] & { command?: string; count?: number };

/**
 * Runs SQL against the local database. As the superuser by default; with
 * `as`, in a transaction with that user's role and JWT claims, so Row Level
 * Security applies exactly as it does for the app's requests.
 */
export async function runSql(query: string, as?: string) {
  const sql = postgres(supabaseEnv().dbUrl, { max: 1, onnotice: () => {} });
  try {
    if (!as) return (await sql.unsafe(query).simple()) as Result | Result[];
    const identity = sqlIdentity(as);
    return (await sql.begin(async (tx) => {
      let claims: Record<string, string> = { role: "anon" };
      if (identity.role === "authenticated") {
        const [user] = await tx<
          AuthUser[]
        >`select id, email from auth.users where email = ${identity.email}`;
        if (!user)
          throw new AgentError(`No user with email ${identity.email}.`);
        claims = {
          sub: user.id,
          email: identity.email,
          role: "authenticated",
          aud: "authenticated",
        };
      }
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.unsafe(`set local role ${identity.role}`);
      return tx.unsafe(query).simple();
    })) as Result | Result[];
  } catch (error) {
    if (error instanceof postgres.PostgresError)
      throw new AgentError(`SQL: ${error.message}`);
    throw error;
  } finally {
    await sql.end();
  }
}
