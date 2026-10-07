// Turns what Next.js reports into a few lines per problem. Everything here is
// pure, so the output format is covered by tests.

export type CompileIssue = {
  severity: string;
  filePath: string;
  title: string;
  source?: { range?: { start?: { line: number; column: number } } };
  codeFrame?: string;
};

type StackFrame = {
  file: string;
  methodName: string;
  line: number | null;
  column: number | null;
};

export type RuntimeError = {
  type: string;
  errorName: string;
  message: string;
  stack?: StackFrame[];
};

export type ErrorState = {
  configErrors?: unknown[];
  sessionErrors?: {
    url: string;
    buildError: unknown;
    runtimeErrors: RuntimeError[];
  }[];
  error?: string;
};

const MAX_MESSAGE = 500;
const MAX_FRAMES = 3;

/** Shortens a message to its first lines, so one error cannot flood the output. */
export function clip(message: string, max = MAX_MESSAGE) {
  const lines = message.trim().split("\n").slice(0, 8).join("\n");
  return lines.length > max ? `${lines.slice(0, max)}…` : lines;
}

const indent = (text: string) => text.replace(/^/gm, "    ");

export function formatCompileIssue(issue: CompileIssue) {
  const file = issue.filePath.replace(/^\[project\]\//, "");
  const start = issue.source?.range?.start;
  const location = start ? `${file}:${start.line}:${start.column}` : file;
  const title = issue.title.replace(/\*\*|`/g, "");
  const frame = issue.codeFrame?.trimEnd();
  return `✗ compile ${location} ${title}${frame ? `\n${indent(frame)}` : ""}`;
}

/**
 * agent-browser marks elements with `data-__ab-*` attributes. When it does so
 * before hydration, React reports a mismatch that the app did not cause.
 */
export function isToolArtifact(error: RuntimeError) {
  return error.message.includes("data-__ab-");
}

export function errorKey(url: string, error: RuntimeError) {
  return `${url}|${error.type}|${error.message.slice(0, 200)}`;
}

export function formatRuntimeError(url: string, error: RuntimeError) {
  const frames = (error.stack ?? [])
    .filter((frame) => frame.file.startsWith("src/"))
    .slice(0, MAX_FRAMES)
    .map(
      (frame) =>
        `    at ${frame.methodName} ${frame.file}:${frame.line}:${frame.column}`,
    );
  const head = `✗ ${error.type} ${url} ${error.errorName}: ${clip(error.message)}`;
  return [head, ...frames].join("\n");
}

/**
 * Runtime errors as lines, each error in full only the first time it is
 * reported. Returns the keys of all current errors, to remember as seen.
 */
export function reportRuntimeErrors(
  state: ErrorState,
  seen: ReadonlySet<string>,
) {
  const lines: string[] = [];
  const keys: string[] = [];
  let repeated = 0;
  for (const session of state.sessionErrors ?? []) {
    for (const error of session.runtimeErrors) {
      if (isToolArtifact(error)) continue;
      const key = errorKey(session.url, error);
      keys.push(key);
      if (seen.has(key)) repeated++;
      else lines.push(formatRuntimeError(session.url, error));
    }
  }
  if (repeated > 0) {
    lines.push(
      `✗ ${repeated} runtime error(s) reported before are still present`,
    );
  }
  return { lines, keys };
}

type LogEntry = { source?: string; level?: string; message?: string };

/**
 * Server errors from new lines of the Next.js dev log. Browser errors are
 * skipped: the dev server forwards them to this log, and `get_errors` already
 * reports them with their stack.
 */
export function serverErrorsFromLog(chunk: string) {
  const lines: string[] = [];
  for (const raw of chunk.split("\n")) {
    if (!raw.trim()) continue;
    let entry: LogEntry;
    try {
      entry = JSON.parse(raw) as LogEntry;
    } catch {
      continue;
    }
    if (entry.level !== "ERROR" || entry.source !== "Server") continue;
    if (!entry.message || entry.message.startsWith("[browser]")) continue;
    lines.push(`✗ server ${clip(entry.message)}`);
  }
  return lines;
}

const DEV_TOOLS = /^\s*- button "Open Next\.js Dev Tools"/;
const EMPTY_NODE = /^\s*- [A-Za-z]+$/;

const depth = (line: string) => line.length - line.trimStart().length;

/** The index after the subtree of the node at `index`. */
function subtreeEnd(lines: string[], index: number) {
  let end = index + 1;
  while (end < lines.length && depth(lines[end]) > depth(lines[index])) end++;
  return end;
}

/**
 * Removes the Next.js development UI: the Dev Tools button and, when there are
 * errors, the overlay and issue badge next to it. All of them share a parent
 * below the top level, which is the page root on error pages. `agent` already
 * reports the errors the overlay shows, in a few lines.
 */
function withoutDevTools(lines: string[]) {
  const button = lines.findIndex((line) => DEV_TOOLS.test(line));
  if (button === -1) return lines;
  let start = button;
  if (depth(lines[button]) > 0) {
    while (start > 0 && depth(lines[start]) >= depth(lines[button])) start--;
    // Never drop a top-level node: on error pages it also holds the page.
    if (depth(lines[start]) === 0) start = button;
  }
  return [...lines.slice(0, start), ...lines.slice(subtreeEnd(lines, start))];
}

/**
 * Trims an agent-browser snapshot without losing page content: drops the
 * Next.js development UI and nodes with neither a name nor children (`- image`,
 * an empty `- alert`).
 */
export function tidySnapshot(snapshot: string) {
  const lines = withoutDevTools(snapshot.split("\n"));
  return lines
    .filter((line, i) => {
      const hasChildren =
        i + 1 < lines.length && depth(lines[i + 1]) > depth(line);
      return hasChildren || !EMPTY_NODE.test(line);
    })
    .join("\n");
}
