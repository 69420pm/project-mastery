/**
 * AI Gateway's free tier allows 5 requests per minute per model and provider
 * (`GatewayRateLimitError`, docs/agents/live-ai.md), and the AI SDK's retries
 * don't wait a 429 out. This holds each gateway request until the last minute
 * has room for it. `EVAL_GATEWAY_RPM` turns it on, such as 4 to stay under 5.
 */
const GATEWAY_HOST = "ai-gateway.vercel.sh";

function isGatewayRequest(url: string) {
  try {
    return new URL(url).hostname === GATEWAY_HOST;
  } catch {
    return false;
  }
}

/** Wraps `fetch` so gateway requests keep within `rpm` per minute. */
export function paceGatewayRequests(rpm: number) {
  const sent: number[] = [];
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (isGatewayRequest(url)) {
      for (;;) {
        const now = Date.now();
        while (sent.length > 0 && sent[0]! <= now - 60_000) sent.shift();
        if (sent.length < rpm) break;
        await new Promise((resolve) =>
          setTimeout(resolve, sent[0]! + 60_000 - now + 100),
        );
      }
      sent.push(Date.now());
    }
    return fetch(input, init);
  };
}
