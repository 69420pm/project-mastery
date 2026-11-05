import postgres from "postgres";
import { AgentError } from "./config";

/**
 * The staging project's rows for agents to review (ADR 0025). The one command
 * here that does not work against the local stack. It sends GET requests only:
 * the secret key bypasses Row Level Security, so it can also write, and the
 * GET-only rule is what keeps agents from doing so.
 */

const envNames = ["STAGING_SUPABASE_URL", "STAGING_SUPABASE_SECRET_KEY"];

type Env = Record<string, string | undefined>;

/** The default row count, so a query without `limit` cannot flood an agent's context. */
export const DEFAULT_LIMIT = 20;
/** The largest row count one call may ask for. */
export const MAX_LIMIT = 200;

/**
 * A table or view name, optionally with a PostgREST query string. Anything
 * else is refused: a slash would reach `rpc/...` (functions can write) or a
 * single row, and only GET requests are sent.
 */
const TABLE_PATH = /^[a-z_][a-z0-9_]*(\?\S*)?$/;

/** The staging project from `.env.local`. Refuses to run without both variables. */
export function stagingEnv(env: Env = process.env) {
  const url = env.STAGING_SUPABASE_URL;
  const secretKey = env.STAGING_SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    const missing = envNames.filter((name) => !env[name]);
    throw new AgentError(
      `Missing ${missing.join(" and ")} in .env.local. Set them from the staging project's API keys (Project URL and secret key).`,
    );
  }
  if (!/^https:\/\//.test(url)) {
    throw new AgentError("STAGING_SUPABASE_URL must start with https://.");
  }
  return { url: url.replace(/\/+$/, ""), secretKey };
}

/**
 * The GET URL for one table query, with the default `limit`. Throws on a path
 * that is not a plain table name, or on a `limit` outside 1..MAX_LIMIT.
 */
export function stagingRequestUrl(baseUrl: string, input: string): URL {
  const trimmed = input.trim();
  if (!TABLE_PATH.test(trimmed)) {
    throw new AgentError(
      `"${input}" is not a table query. Give a table name with optional PostgREST parameters, for example: agent staging "materials?select=id,title&limit=5"`,
    );
  }
  const url = new URL(`${baseUrl}/rest/v1/${trimmed}`);
  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
  }
  const limit = url.searchParams.get("limit") ?? "";
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
    throw new AgentError(
      `limit must be a whole number from 1 to ${MAX_LIMIT}, got "${limit}".`,
    );
  }
  return url;
}

/**
 * Runs one read against the staging REST API and returns the rows as one line
 * of JSON.
 */
export async function queryStaging(
  input: string,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const { url, secretKey } = stagingEnv(env);
  const response = await fetchFn(stagingRequestUrl(url, input), {
    method: "GET",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new AgentError(
      `Staging returned ${response.status}: ${body.slice(0, 500)}`,
    );
  }
  return JSON.stringify(JSON.parse(body));
}

/** The most rows one SQL call prints. */
export const SQL_ROW_LIMIT = 200;

/** Statements that only read. Anything else is refused before it reaches the database. */
const READ_STATEMENT = /^\s*(select|with|table|values|show|explain)\b/i;

/**
 * One read-only statement, or a refusal. A second statement after a `;` could
 * end the read-only transaction, so it is refused too.
 */
export function checkReadQuery(query: string): string {
  const trimmed = query.trim().replace(/;\s*$/, "");
  if (!READ_STATEMENT.test(trimmed)) {
    throw new AgentError(
      "staging-sql runs reads only: the query must start with select, with, table, values, show or explain.",
    );
  }
  if (trimmed.includes(";")) {
    throw new AgentError("staging-sql runs one statement at a time.");
  }
  return trimmed;
}

/**
 * The staging database's connection string from `.env.local`: a Postgres
 * role that can only read (ADR 0025). The role is the real guard; the read-only
 * transaction below is a second layer.
 */
export function stagingDatabaseUrl(env: Env = process.env): string {
  const url = env.STAGING_DATABASE_URL;
  if (!url) {
    throw new AgentError(
      "Missing STAGING_DATABASE_URL in .env.local. Set it to the connection string of the read-only staging role (ADR 0025).",
    );
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new AgentError("STAGING_DATABASE_URL must start with postgresql://.");
  }
  return url;
}

/**
 * Runs one read-only query against the staging database. Prints at most
 * SQL_ROW_LIMIT rows, as one JSON line each, and says how many were left out.
 */
export async function queryStagingSql(
  query: string,
  env: Env = process.env,
): Promise<string> {
  const statement = checkReadQuery(query);
  const sql = postgres(stagingDatabaseUrl(env), {
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
  });
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '15s'`;
      return tx.unsafe(statement);
    });
    const shown = rows
      .slice(0, SQL_ROW_LIMIT)
      .map((row) => JSON.stringify(row));
    if (rows.length > SQL_ROW_LIMIT) {
      shown.push(
        `(${rows.length} rows, showing ${SQL_ROW_LIMIT}; add a LIMIT to the query)`,
      );
    }
    return shown.join("\n") || "(no rows)";
  } catch (error) {
    if (error instanceof postgres.PostgresError) {
      throw new AgentError(`Staging database: ${error.message}`);
    }
    throw error;
  } finally {
    await sql.end();
  }
}
