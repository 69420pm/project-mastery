// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const start = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("workflow/api", () => ({ start }));

const { startParse } = await import("./start-parse");

test("a parse that cannot start leaves the upload successful and is logged", async () => {
  start.mockRejectedValueOnce(new Error("queue unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(startParse("material-1")).resolves.toBeUndefined();

  expect(log).toHaveBeenCalledWith(
    "Starting the parse of a Material failed:",
    expect.objectContaining({ message: "queue unavailable" }),
  );
});
