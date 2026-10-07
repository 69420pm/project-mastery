// @vitest-environment node
import { describe, expect, test } from "vitest";
import { parseToolResult } from "./next-mcp";

describe("parseToolResult", () => {
  test("unwraps the JSON payload from the SSE data line", () => {
    const body = `event: message\ndata: ${JSON.stringify({
      result: { content: [{ type: "text", text: '{"issues":[]}' }] },
      jsonrpc: "2.0",
      id: 1,
    })}\n\n`;
    expect(parseToolResult(body)).toEqual({ issues: [] });
  });

  test("fails on an unexpected reply", () => {
    expect(() => parseToolResult("<html>")).toThrow(
      "Unexpected /_next/mcp reply",
    );
  });
});
