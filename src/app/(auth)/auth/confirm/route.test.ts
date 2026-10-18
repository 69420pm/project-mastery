// @vitest-environment node
import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";

const confirmEmailLink = vi.fn();
vi.mock("@/features/auth/server", () => ({ confirmEmailLink }));

const { GET } = await import("./route");

test("GET hands the email link's request to confirmEmailLink", async () => {
  const request = new NextRequest(
    "http://localhost:3000/auth/confirm?token_hash=abc&type=email",
  );
  const response = new Response(null, { status: 307 });
  confirmEmailLink.mockResolvedValue(response);

  await expect(GET(request)).resolves.toBe(response);
  expect(confirmEmailLink).toHaveBeenCalledWith(request);
});
