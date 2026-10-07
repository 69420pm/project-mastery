import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** An expected failure: the CLI prints the message without a stack trace. */
export class AgentError extends Error {}

// pnpm runs scripts from the package root, also inside a worktree.
export const ROOT = process.cwd();
export const CACHE_DIR = path.join(ROOT, "node_modules/.cache/agent");
export const BIN = (name: string) => path.join(ROOT, "node_modules/.bin", name);
export const DEFAULT_PORT = 3000;

/** One browser session per checkout, so parallel worktrees never share one. */
export const BROWSER_SESSION = `app-${createHash("sha1").update(ROOT).digest("hex").slice(0, 8)}`;

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * The local Supabase stack from `.env.local`. Refuses any other host: the CLI
 * creates users, resets data and runs SQL as the superuser.
 */
export function supabaseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new AgentError(
      `Missing Supabase variables in .env.local (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}). Copy them from \`pnpm db:status\`.`,
    );
  }
  const url = new URL(parsed.data.NEXT_PUBLIC_SUPABASE_URL);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new AgentError(
      `NEXT_PUBLIC_SUPABASE_URL points at ${url.host}. The agent CLI only works against the local stack (127.0.0.1).`,
    );
  }
  const ports = readTomlPorts(
    readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8"),
  );
  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""),
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey: parsed.data.SUPABASE_SECRET_KEY,
    dbUrl: `postgresql://postgres:postgres@127.0.0.1:${ports.db ?? 54322}/postgres`,
    mailUrl: `http://127.0.0.1:${ports.local_smtp ?? ports.inbucket ?? 54324}`,
    studioUrl: `http://127.0.0.1:${ports.studio ?? 54323}`,
  };
}

/** The first `port = N` of each section in supabase/config.toml. */
export function readTomlPorts(toml: string): Record<string, number> {
  const ports: Record<string, number> = {};
  let section = "";
  for (const line of toml.split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      section = header[1];
      continue;
    }
    const port = line.match(/^\s*port\s*=\s*(\d+)/);
    if (port && !(section in ports)) ports[section] = Number(port[1]);
  }
  return ports;
}

/** What the CLI remembers between calls, per checkout. */
export type State = {
  /** Port of this checkout's dev server. */
  port?: number;
  /** Process group of the dev server that `agent up` started. */
  pid?: number;
  /** Bytes of the Next.js dev log already reported. */
  logOffset?: number;
  /** Runtime errors already reported in full. */
  seenErrors?: string[];
};

const STATE_FILE = path.join(CACHE_DIR, "state.json");

export function readState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<State>) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }));
}
