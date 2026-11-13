/**
 * Holds model requests within the free tiers' limits, for the smoke checks
 * and the tutoring scenarios (docs/agents/live-ai.md).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The Gemini free tier's limit: 15 requests per minute (`notes/ai-sdk.md`).
 * The AI SDK's retries don't wait a 429 out, and a reply of several steps
 * makes several requests, so each Gemini request waits until the last
 * minute has room for it. `AI_SMOKE_RPM` sets another limit.
 */
const GEMINI_RPM = Number(process.env.AI_SMOKE_RPM || 14);

/**
 * AI Gateway's free credit: 5 requests per minute per provider, for
 * `cohere/embed-v5.0-fast` as for MiMo and Muse Ember
 * (docs/agents/live-ai.md). A build's embeddings come faster, so those
 * requests wait too.
 */
const GATEWAY_RPM = 5;

/** The request limit per minute of `url`'s host; null when unpaced. */
function limitOf(url: string): { host: string; rpm: number } | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === "generativelanguage.googleapis.com") {
    return { host, rpm: GEMINI_RPM };
  }
  if (host === "ai-gateway.vercel.sh") return { host, rpm: GATEWAY_RPM };
  return null;
}

/**
 * The last minute's request times per host, shared by the processes of one
 * machine: `pnpm tutor-eval say` runs once per Student message, and each run
 * has to know what the one before it sent.
 */
const SENT_FILE = path.join(os.tmpdir(), "project-mastery-model-requests.json");

function readSent(): Record<string, number[]> {
  try {
    return JSON.parse(readFileSync(SENT_FILE, "utf8")) as Record<
      string,
      number[]
    >;
  } catch {
    return {};
  }
}

/** Wraps `fetch` so Gemini and AI Gateway requests keep within their limits. */
export function paceModelRequests() {
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const limit = limitOf(url);
    if (limit) {
      for (;;) {
        const now = Date.now();
        const sent = (readSent()[limit.host] ?? []).filter(
          (time) => time > now - 60_000,
        );
        if (sent.length < limit.rpm) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(...sent) + 60_000 - now + 100),
        );
      }
      const all = readSent();
      const now = Date.now();
      all[limit.host] = [
        ...(all[limit.host] ?? []).filter((time) => time > now - 60_000),
        now,
      ];
      // Written beside the file and renamed, so a reader never sees half a file.
      const temp = `${SENT_FILE}.${process.pid}`;
      writeFileSync(temp, JSON.stringify(all));
      renameSync(temp, SENT_FILE);
    }
    return fetch(input, init);
  };
}
