import { closeSync, openSync, readSync, statSync } from "node:fs";
import { readState, writeState } from "./config";
import { callNextTool } from "./next-mcp";
import {
  formatCompileIssue,
  reportRuntimeErrors,
  serverErrorsFromLog,
  type CompileIssue,
  type ErrorState,
} from "./report";

/** New server errors in the Next.js dev log since the last report. */
async function newServerErrors(port: number) {
  const { logFilePath } = await callNextTool<{ logFilePath: string }>(
    port,
    "get_logs",
  );
  let size: number;
  try {
    size = statSync(logFilePath).size;
  } catch {
    return [];
  }
  // Without a stored offset, start at the end: older errors may be long fixed.
  // A restarted dev server starts a new, shorter log.
  const offset = Math.min(readState().logOffset ?? size, size);
  const buffer = Buffer.alloc(size - offset);
  const fd = openSync(logFilePath, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(fd);
  }
  writeState({ logOffset: size });
  return serverErrorsFromLog(buffer.toString("utf8"));
}

// Next.js waits this long for every connected page to answer `get_errors`.
const BROWSER_TIMEOUT_MS = 5000;
const STALE_CONNECTION =
  "note: a stale browser connection made this 5 s slower; `pnpm -s agent browser close` fixes it (sign-in is kept)";

/** Runtime errors Next.js collected from connected browsers. */
async function runtimeErrors(port: number) {
  const started = Date.now();
  const state = await callNextTool<ErrorState>(port, "get_errors");
  if (state.error) return { lines: [], connected: false, notes: [] };
  const seen = new Set(readState().seenErrors ?? []);
  const { lines, keys } = reportRuntimeErrors(state, seen);
  writeState({ seenErrors: keys });
  // After a server error page, the browser keeps a dev connection that never
  // answers, until the browser restarts.
  const slow = Date.now() - started >= BROWSER_TIMEOUT_MS;
  return { lines, connected: true, notes: slow ? [STALE_CONNECTION] : [] };
}

/**
 * Problems that appeared since the last call: runtime errors and server
 * errors. Empty when everything is fine, so a clean page costs no output.
 */
export async function newProblems(port: number) {
  const [runtime, server] = await Promise.all([
    runtimeErrors(port),
    newServerErrors(port),
  ]);
  return [...runtime.lines, ...server, ...runtime.notes];
}

/** The full check: compile issues across all routes plus new problems. */
export async function checkAll(port: number) {
  const [compile, runtime, server] = await Promise.all([
    callNextTool<{ issues: CompileIssue[] }>(port, "get_compilation_issues", {
      timeoutMs: 180_000,
    }),
    runtimeErrors(port),
    newServerErrors(port),
  ]);
  const issues = compile.issues.filter((issue) => issue.severity === "error");
  return [
    issues.length === 0
      ? "compile   ok"
      : issues.map(formatCompileIssue).join("\n"),
    !runtime.connected
      ? "runtime   no browser session yet (open a page first)"
      : runtime.lines.length === 0
        ? "runtime   ok"
        : runtime.lines.join("\n"),
    server.length === 0 ? "server    ok" : server.join("\n"),
    ...runtime.notes,
  ];
}
