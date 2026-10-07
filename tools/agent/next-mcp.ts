import { AgentError } from "./config";

/**
 * Calls a tool of the dev server's built-in MCP endpoint (`/_next/mcp`), which
 * reports what Next.js knows: routes, compile issues, runtime errors, logs.
 */
export async function callNextTool<T>(
  port: number,
  name: string,
  { timeoutMs = 10_000 } = {},
): Promise<T> {
  const response = await fetch(`http://localhost:${port}/_next/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return parseToolResult<T>(await response.text());
}

/** Unwraps the JSON payload from an SSE `tools/call` reply. */
export function parseToolResult<T>(body: string): T {
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data)
    throw new AgentError(`Unexpected /_next/mcp reply: ${body.slice(0, 200)}`);
  const message = JSON.parse(data) as {
    result?: { content?: { text?: string }[] };
    error?: { message?: string };
  };
  const text = message.result?.content?.[0]?.text;
  if (text === undefined) {
    throw new AgentError(
      `/_next/mcp: ${message.error?.message ?? data.slice(0, 200)}`,
    );
  }
  return JSON.parse(text) as T;
}

export type ProjectMetadata = { projectPath: string; devServerUrl: string };

/** The project a dev server on `port` serves, or null when none answers. */
export async function projectOnPort(port: number) {
  try {
    return await callNextTool<ProjectMetadata>(port, "get_project_metadata", {
      timeoutMs: 3000,
    });
  } catch {
    return null;
  }
}
