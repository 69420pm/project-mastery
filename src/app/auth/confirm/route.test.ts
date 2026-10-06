// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const auth = {
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const { GET } = await import("./route");

function request(query: string) {
  return new NextRequest(`http://localhost:3000/auth/confirm?${query}`);
}

beforeEach(() => {
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe("GET /auth/confirm", () => {
  test("verifies a token hash and redirects to next", async () => {
    await expect(
      GET(request("token_hash=abc&type=email&next=%2Fcourses")),
    ).rejects.toThrow("redirect:/courses");

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "abc",
    });
  });

  test("unwraps the redirect URL that email templates pass as next", async () => {
    const next = encodeURIComponent(
      "http://localhost:3000/auth/confirm?next=%2Fcourses",
    );
    await expect(
      GET(request(`token_hash=abc&type=email&next=${next}`)),
    ).rejects.toThrow("redirect:/courses");
  });

  test("exchanges a PKCE code", async () => {
    await expect(GET(request("code=xyz&next=%2Fcourses"))).rejects.toThrow(
      "redirect:/courses",
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  test("never redirects off-site", async () => {
    await expect(
      GET(request("code=xyz&next=https%3A%2F%2Fevil.example")),
    ).rejects.toThrow(/^redirect:\/$/);
  });

  test("sends invalid or expired links to the error page", async () => {
    auth.verifyOtp.mockResolvedValue({ error: new Error("expired") });
    await expect(GET(request("token_hash=abc&type=email"))).rejects.toThrow(
      "redirect:/auth/error",
    );

    await expect(GET(request("token_hash=abc&type=bogus"))).rejects.toThrow(
      "redirect:/auth/error",
    );
    await expect(GET(request(""))).rejects.toThrow("redirect:/auth/error");
  });
});
