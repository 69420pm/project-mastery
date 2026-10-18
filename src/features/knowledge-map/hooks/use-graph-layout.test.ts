import { renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useGraphLayout } from "./use-graph-layout";

// A layout worker that fails, as when its script does not load.
vi.mock("elkjs/lib/elk-api", () => ({
  default: class {
    layout() {
      return Promise.reject(new Error("worker failed"));
    }
  },
}));

test("reports a failed layout instead of waiting for it forever", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const graph = { id: "root", children: [{ id: "a", width: 10, height: 10 }] };

  const { result } = renderHook(() => useGraphLayout(graph));

  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.laidOut).toBeNull();
});
