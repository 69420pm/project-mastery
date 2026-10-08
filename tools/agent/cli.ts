/**
 * Drives the running app for coding agents (ADR 0015):
 *
 *   pnpm -s agent help
 *
 * Every command prints only what an agent needs to decide the next step, so
 * a clean result costs a line, not a page. Works only against the local stack.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { browser, react, settle, SHOT_DIR, snapshot } from "./browser";
import { AgentError, BROWSER_SESSION, supabaseEnv, writeState } from "./config";
import {
  DEV_LOG,
  findDevServer,
  ownsDevServer,
  requireDevServer,
  startDevServer,
  stopDevServer,
} from "./dev-server";
import { checkAll, newProblems } from "./diagnostics";
import { formatMail, latestMail } from "./mail";
import { callNextTool } from "./next-mcp";
import { PERSONA_PASSWORD, PERSONAS, persona } from "./personas";
import { formatSqlResult } from "./sql-format";
import {
  ensurePersonas,
  isSupabaseUp,
  resetDatabase,
  runSql,
  startSupabase,
} from "./supabase";

const HELP = `pnpm -s agent <command>   (local stack only)

Setup
  up                     start Supabase and next dev if needed, create test users
  down                   stop the dev server that \`up\` started
  status                 what is running, with URLs
  reset                  recreate the database from migrations and the test users

Browser (one session per checkout, login survives restarts)
  login [persona]        sign in through the login form (default: student)
  logout                 clear the session cookies
  open <path|url>        navigate; print URL, page snapshot and new errors
  look                   print URL, page snapshot and new errors
  act <command...>       run an agent-browser command, then \`look\`
                         e.g. act click @e9 · act fill @e10 "text" · act press Enter
  browser <command...>   any other agent-browser command (prints its output)
  react <command...>     React DevTools: tree, inspect <id>, renders start|stop
  shot [--full]          screenshot; prints the file path

Diagnostics
  check                  compile issues (all routes), runtime and server errors
  routes                 the app's routes

Data
  sql "<query>" [--as student|classmate|anon|<email>] [--all]
                         run SQL; --as applies Row Level Security for that user
  mail [email] [--body]  latest email (to <email>): subject and links
  users                  test users and their password`;

const appUrl = (port: number, target: string) =>
  /^https?:\/\//.test(target)
    ? target
    : `http://localhost:${port}${target.startsWith("/") ? "" : "/"}${target}`;

/** URL, snapshot, and only the problems that are new since the last look. */
async function look(port: number) {
  const [page, problems] = await Promise.all([snapshot(), newProblems(port)]);
  return problems.length === 0 ? page : `${page}\n\n${problems.join("\n")}`;
}

async function up() {
  const lines: string[] = [];
  const supabase = supabaseEnv();
  if (await isSupabaseUp()) {
    lines.push(
      `supabase  running · studio ${supabase.studioUrl} · mail ${supabase.mailUrl}`,
    );
  } else {
    await startSupabase();
    lines.push(
      `supabase  started · studio ${supabase.studioUrl} · mail ${supabase.mailUrl}`,
    );
  }
  await ensurePersonas();
  lines.push(
    `users     ${Object.keys(PERSONAS).join(", ")} (\`agent login <name>\`)`,
  );
  const running = await findDevServer();
  if (running !== null) {
    lines.push(`app       running · http://localhost:${running}`);
  } else {
    const { port, pid } = await startDevServer();
    lines.push(
      `app       started · http://localhost:${port} (pid ${pid}, log ${path.relative(process.cwd(), DEV_LOG)})`,
    );
  }
  return lines.join("\n");
}

async function status() {
  const supabase = (await isSupabaseUp())
    ? "running"
    : "stopped (run `agent up`)";
  const port = await findDevServer();
  const app =
    port === null
      ? "stopped (run `agent up`)"
      : `running · http://localhost:${port}${ownsDevServer() ? "" : " (not started by `agent up`)"}`;
  return [
    `supabase  ${supabase}`,
    `app       ${app}`,
    `browser   session ${BROWSER_SESSION}`,
  ].join("\n");
}

async function login(name = "student") {
  const port = await requireDevServer();
  const { email } = persona(name);
  await ensurePersonas();
  await browser(["cookies", "clear"]);
  await browser(["open", appUrl(port, "/login")]);
  await settle();
  await browser(["find", "label", "Email", "fill", email]);
  await browser(["find", "label", "Password", "fill", PERSONA_PASSWORD]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Sign in",
    "--exact",
  ]);
  const { ok } = await browser(
    ["wait", "--url", "**/dashboard", "--timeout", "15000"],
    {
      allowFailure: true,
    },
  );
  if (!ok)
    throw new AgentError(
      `Sign-in did not reach /dashboard:\n${await snapshot()}`,
    );
  return `signed in as ${name} (${email})`;
}

async function sql(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { as: { type: "string" }, all: { type: "boolean" } },
  });
  const query = positionals.join(" ").trim();
  if (!query)
    throw new AgentError(
      'Usage: agent sql "<query>" [--as <persona|anon|email>] [--all]',
    );
  return formatSqlResult(await runSql(query, values.as), { all: values.all });
}

async function mail(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { body: { type: "boolean" } },
  });
  return formatMail(await latestMail(positionals[0]), { body: values.body });
}

async function shot(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { full: { type: "boolean" } },
  });
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(
    SHOT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );
  await browser(["screenshot", ...(values.full ? ["--full"] : []), file]);
  return path.relative(process.cwd(), file);
}

async function run(
  command: string | undefined,
  args: string[],
): Promise<string> {
  switch (command) {
    case "up":
      return up();
    case "down":
      return stopDevServer();
    case "status":
      return status();
    case "reset":
      await resetDatabase();
      await ensurePersonas();
      writeState({ seenErrors: [] });
      return "database reset · test users recreated · sign in again with `agent login`";
    case "login":
      return login(args[0]);
    case "logout":
      await browser(["cookies", "clear"]);
      return "signed out";
    case "open": {
      if (!args[0]) throw new AgentError("Usage: agent open <path|url>");
      const port = await requireDevServer();
      await browser(["open", appUrl(port, args[0])]);
      await settle();
      return look(port);
    }
    case "look":
      return look(await requireDevServer());
    case "act": {
      if (args.length === 0)
        throw new AgentError("Usage: agent act <agent-browser command>");
      const port = await requireDevServer();
      const { output } = await browser(args);
      await settle();
      const page = await look(port);
      return output ? `${output}\n${page}` : page;
    }
    case "browser":
      return (await browser(args)).output;
    case "react":
      return react(args);
    case "shot":
      return shot(args);
    case "check":
      return (await checkAll(await requireDevServer())).join("\n");
    case "routes": {
      const { appRouter } = await callNextTool<{ appRouter: string[] }>(
        await requireDevServer(),
        "get_routes",
      );
      return appRouter
        .filter((route) => !route.startsWith("/.well-known/"))
        .join("\n");
    }
    case "sql":
      return sql(args);
    case "mail":
      return mail(args);
    case "users":
      return Object.entries(PERSONAS)
        .map(([name, { email }]) => `${name.padEnd(10)}${email}`)
        .concat(`password  ${PERSONA_PASSWORD}`)
        .join("\n");
    case undefined:
    case "help":
    case "--help":
      return HELP;
    default:
      throw new AgentError(
        `Unknown command "${command}". Run \`pnpm -s agent help\`.`,
      );
  }
}

const [command, ...args] = process.argv.slice(2);
run(command, args).then(
  (output) => {
    if (output) console.info(output);
  },
  (error: unknown) => {
    console.error(error instanceof AgentError ? error.message : error);
    process.exitCode = 1;
  },
);
