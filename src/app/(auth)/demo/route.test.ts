// @vitest-environment node
import { expect, test, vi } from "vitest";

const signInDemo = vi.fn();
vi.mock("@/features/auth/server", () => ({ signInDemo }));

const { GET } = await import("./route");

test("GET hands the demo link to signInDemo", async () => {
  const response = new Response(null, { status: 307 });
  signInDemo.mockResolvedValue(response);

  await expect(GET()).resolves.toBe(response);
  expect(signInDemo).toHaveBeenCalledOnce();
});
