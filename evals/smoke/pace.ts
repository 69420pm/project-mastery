/**
 * Holds model requests within the free tiers' limits, for the smoke checks
 * and the tutoring scenarios (docs/agents/live-ai.md).
 */

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

/** Wraps `fetch` so Gemini and AI Gateway requests keep within their limits. */
export function paceModelRequests() {
  const sentBy = new Map<string, number[]>();
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const limit = limitOf(url);
    if (limit) {
      const sent = sentBy.get(limit.host) ?? [];
      sentBy.set(limit.host, sent);
      for (;;) {
        const now = Date.now();
        while (sent.length > 0 && sent[0]! <= now - 60_000) sent.shift();
        if (sent.length < limit.rpm) break;
        await new Promise((resolve) =>
          setTimeout(resolve, sent[0]! + 60_000 - now + 100),
        );
      }
      sent.push(Date.now());
    }
    return fetch(input, init);
  };
}
