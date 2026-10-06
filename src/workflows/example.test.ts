// @vitest-environment node
import { FatalError } from "workflow";
import { afterEach, describe, expect, test, vi } from "vitest";
import { exampleWorkflow, processItem, reportProgress } from "./example";

// Without the workflow compiler, "use workflow" and "use step" are no-ops, so
// steps (and workflows that only call steps) run as plain functions.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processItem", () => {
  test("counts the words of an item", async () => {
    await expect(processItem("  derive the chain rule ")).resolves.toEqual({
      item: "derive the chain rule",
      words: 4,
    });
  });

  test("fails without retries on an empty item", async () => {
    await expect(processItem("   ")).rejects.toBeInstanceOf(FatalError);
  });

  test("retries up to 5 times", () => {
    expect(processItem.maxRetries).toBe(5);
  });
});

test("reportProgress logs the progress of a job", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});

  await reportProgress("job-1", { done: 1, total: 2 });

  expect(log).toHaveBeenCalledWith("[job job-1] 1/2 items");
});

test("exampleWorkflow processes every item and reports progress", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});

  const result = await exampleWorkflow({
    jobId: "job-1",
    items: ["one", "two words"],
  });

  expect(result).toEqual({
    jobId: "job-1",
    results: [
      { item: "one", words: 1 },
      { item: "two words", words: 2 },
    ],
  });
  expect(log).toHaveBeenLastCalledWith("[job job-1] 2/2 items");
});
