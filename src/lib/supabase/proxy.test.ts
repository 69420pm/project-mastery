// @vitest-environment node
import type { CookieMethodsServer } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getClaims = vi.fn();
let cookieMethods: CookieMethodsServer | undefined;

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, options: { cookies: CookieMethodsServer }) => {
      cookieMethods = options.cookies;
      return { auth: { getClaims } };
    },
  ),
}));

const { updateSession } = await import("./proxy");

beforeEach(() => {
  cookieMethods = undefined;
  getClaims.mockReset().mockResolvedValue({ data: null, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  test("skips the refresh when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    const response = await updateSession(
      new NextRequest("http://localhost:3000/"),
    );

    expect(response.status).toBe(200);
    expect(getClaims).not.toHaveBeenCalled();
  });

  test("validates the session on every request", async () => {
    await updateSession(new NextRequest("http://localhost:3000/courses"));
    expect(getClaims).toHaveBeenCalledOnce();
  });

  test("passes refreshed cookies and no-cache headers to the response", async () => {
    getClaims.mockImplementation(async () => {
      await cookieMethods?.setAll?.(
        [{ name: "sb-auth-token", value: "refreshed", options: { path: "/" } }],
        { "Cache-Control": "private, no-store" },
      );
      return { data: null, error: null };
    });

    const response = await updateSession(
      new NextRequest("http://localhost:3000/courses", {
        headers: { cookie: "sb-auth-token=stale" },
      }),
    );

    expect(response.cookies.get("sb-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
