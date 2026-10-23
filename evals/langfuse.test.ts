// @vitest-environment node
import type { LangfuseClient } from "@langfuse/client";
import { expect, test, vi } from "vitest";
import { createEvalLangfuse } from "./langfuse";

function call(traceId: string, startTime: string, output: string) {
  return { traceId, startTime, input: "[]", output: JSON.stringify(output) };
}

test("chatReplies keeps each trace's last model call, newest first, without excluded traces", async () => {
  const getMany = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        call("b", "2026-10-23T10:05:00Z", "B, final"),
        call("b", "2026-10-23T10:04:00Z", "B, tool step"),
        call("old", "2026-10-23T10:03:00Z", "queued already"),
      ],
      meta: { cursor: "next" },
    })
    .mockResolvedValueOnce({
      data: [call("a", "2026-10-23T09:00:00Z", "A")],
      meta: {},
    });
  const client = { api: { observations: { getMany } } } as never;

  const traces = await createEvalLangfuse(client as LangfuseClient).chatReplies(
    { limit: 5, exclude: new Set(["old"]) },
  );

  expect(traces.map(({ traceId, output }) => [traceId, output])).toEqual([
    ["b", "B, final"],
    ["a", "A"],
  ]);
  expect(getMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: "next" }),
  );
});
