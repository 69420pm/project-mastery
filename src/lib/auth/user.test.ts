// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";

const getClaims = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const { getUser, requireUser } = await import("./user");

const USER_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  getClaims.mockReset();
});

describe("getUser", () => {
  test("returns the user from verified JWT claims", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: USER_ID, email: "alice@example.com" } },
      error: null,
    });

    await expect(getUser()).resolves.toEqual({
      id: USER_ID,
      email: "alice@example.com",
    });
  });

  test("returns null without a valid session", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(getUser()).resolves.toBeNull();

    getClaims.mockResolvedValue({
      data: null,
      error: new Error("invalid JWT"),
    });
    await expect(getUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  test("returns the signed-in user", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: USER_ID } },
      error: null,
    });

    await expect(requireUser()).resolves.toEqual({
      id: USER_ID,
      email: undefined,
    });
  });

  test("redirects to /login with the return path when signed out", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    await expect(requireUser("/courses?tab=plan")).rejects.toThrow(
      "redirect:/login?next=%2Fcourses%3Ftab%3Dplan",
    );
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
});
