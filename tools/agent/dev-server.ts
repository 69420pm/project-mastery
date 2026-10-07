import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  AgentError,
  BIN,
  CACHE_DIR,
  DEFAULT_PORT,
  ROOT,
  readState,
  writeState,
} from "./config";
import { readFrom } from "./fs";
import { projectOnPort } from "./next-mcp";

export const DEV_LOG = path.join(CACHE_DIR, "next-dev.log");
const START_TIMEOUT_MS = 90_000;

/** The port of this checkout's running dev server, or null. */
export async function findDevServer() {
  const candidates = [...new Set([readState().port, DEFAULT_PORT])];
  for (const port of candidates) {
    if (port === undefined) continue;
    const project = await projectOnPort(port);
    if (project?.projectPath === ROOT) return port;
  }
  return null;
}

/** Like findDevServer, but fails with the fix when none is running. */
export async function requireDevServer() {
  const port = await findDevServer();
  if (port === null) {
    throw new AgentError(
      "No dev server for this checkout. Run `pnpm -s agent up`.",
    );
  }
  return port;
}

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

async function freePort() {
  // Another checkout (a worktree) may already serve the default port.
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new AgentError(`No free port in ${DEFAULT_PORT}-${DEFAULT_PORT + 19}.`);
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts `next dev` in the background and waits until it answers. */
export async function startDevServer() {
  const port = await freePort();
  mkdirSync(CACHE_DIR, { recursive: true });
  // Read back through the same descriptor if the server fails to start.
  const log = openSync(DEV_LOG, "w+");
  const child = spawn(BIN("next"), ["dev", "--port", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  if (child.pid === undefined)
    throw new AgentError("Could not start next dev.");
  writeState({ port, pid: child.pid, logOffset: 0, seenErrors: [] });

  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((await projectOnPort(port))?.projectPath === ROOT)
        return { port, pid: child.pid };
      if (!isRunning(child.pid)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const tail = readFrom(log).text.trim().split("\n").slice(-20).join("\n");
    throw new AgentError(`next dev did not start on port ${port}:\n${tail}`);
  } finally {
    // The server writes through its own copy of the descriptor.
    closeSync(log);
  }
}

/** Stops the dev server that `agent up` started. */
export async function stopDevServer() {
  const { pid } = readState();
  if (pid === undefined || !isRunning(pid)) {
    const port = await findDevServer();
    writeState({ pid: undefined });
    return port === null
      ? "app       not running"
      : `app       running on port ${port}, but not started by \`agent up\`: stop it where it was started`;
  }
  // The server runs in its own process group; stop next and its workers.
  process.kill(-pid, "SIGTERM");
  writeState({ pid: undefined });
  return `app       stopped (pid ${pid})`;
}

export function ownsDevServer() {
  const { pid } = readState();
  return pid !== undefined && isRunning(pid);
}
