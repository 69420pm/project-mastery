import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { AgentError, BIN, BROWSER_SESSION, CACHE_DIR } from "./config";
import { tidySnapshot } from "./report";

export const SHOT_DIR = path.join(CACHE_DIR, "shots");

/**
 * agent-browser settings for this checkout's session: Playwright's Chromium
 * (agent-browser does not find it by itself), React DevTools for `react`
 * commands, and login state restored across browser restarts.
 */
function browserEnv() {
  const executable = chromium.executablePath();
  if (!existsSync(executable)) {
    throw new AgentError(
      "Chromium is missing. Run `pnpm exec playwright install chromium`.",
    );
  }
  return {
    ...process.env,
    AGENT_BROWSER_SESSION: BROWSER_SESSION,
    AGENT_BROWSER_RESTORE: BROWSER_SESSION,
    AGENT_BROWSER_EXECUTABLE_PATH: executable,
    AGENT_BROWSER_ENABLE: "react-devtools",
    AGENT_BROWSER_SCREENSHOT_DIR: SHOT_DIR,
    AGENT_BROWSER_MAX_OUTPUT: "20000",
  };
}

// Status lines agent-browser prints on every command; they carry no news.
const NOISE = [/^\[agent-browser\] restore: /, /^✓ Done$/];

/** Runs an agent-browser command in this checkout's session. */
export function browser(args: string[], { allowFailure = false } = {}) {
  const env = browserEnv();
  return new Promise<{ ok: boolean; output: string }>((resolve, reject) => {
    const child = spawn(BIN("agent-browser"), args, { env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const text = output
        .split("\n")
        .filter((line) => !NOISE.some((pattern) => pattern.test(line)))
        .join("\n")
        .trim();
      if (code !== 0 && !allowFailure) {
        reject(new AgentError(`agent-browser ${args[0]}: ${text}`));
      } else {
        resolve({ ok: code === 0, output: text });
      }
    });
  });
}

/** Waits until the page has loaded and settled, without failing on timeout. */
export async function settle() {
  await browser(["wait", "--load", "networkidle", "--timeout", "5000"], {
    allowFailure: true,
  });
}

/** The current URL and a compact accessibility snapshot of the page. */
export async function snapshot() {
  const { output: url } = await browser(["get", "url"]);
  // The full tree: compact mode (-c) drops some text, such as lone paragraphs.
  const { output: tree } = await browser(["snapshot"]);
  return `${url}\n${tidySnapshot(tree)}`;
}

/** `react` commands print only in JSON mode in agent-browser 0.38. */
export async function react(args: string[]) {
  const { output } = await browser(["react", ...args, "--json"]);
  const reply = JSON.parse(output) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
  if (!reply.success) throw new AgentError(`react ${args[0]}: ${reply.error}`);
  // `lifecycle` describes the browser launch, not the answer.
  const data = { ...reply.data };
  delete data.lifecycle;
  const values = Object.values(data);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : JSON.stringify(data, null, 2);
}
