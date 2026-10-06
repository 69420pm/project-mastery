// @vitest-environment node
import { start } from "workflow/api";
import { afterEach, expect, test, vi } from "vitest";
import { exampleWorkflow } from "@/workflows/example";
import { POST } from "./route";

// Unit tests have no workflow runtime; `start` is checked by its arguments.
vi.mock("workflow/api", () => ({
  start: vi.fn(async () => ({ runId: "wrun_test" })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function request(body: unknown) {
  return new Request("http://localhost/api/workflows/example", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

test("starts the example workflow and returns the run id", async () => {
  const response = await POST(request({ items: ["a", "b"] }));

  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ runId: "wrun_test" });
  expect(start).toHaveBeenCalledWith(exampleWorkflow, [
    { jobId: expect.any(String), items: ["a", "b"] },
  ]);
});

test("rejects a body without items", async () => {
  const response = await POST(request({ items: [] }));

  expect(response.status).toBe(400);
  expect(start).not.toHaveBeenCalled();
});

test("is disabled in production", async () => {
  vi.stubEnv("VERCEL_ENV", "production");

  const response = await POST(request({ items: ["a"] }));

  expect(response.status).toBe(404);
  expect(start).not.toHaveBeenCalled();
});
