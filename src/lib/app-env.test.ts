import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveSiteUrl } from "./app-env";

describe("resolveSiteUrl", () => {
  test("prefers an explicit NEXT_PUBLIC_SITE_URL", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://mastery.example",
        NEXT_PUBLIC_VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://mastery.example");
  });

  test("uses the production domain on Vercel production", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_VERCEL_ENV: "production",
        NEXT_PUBLIC_VERCEL_URL: "deployment-abc.vercel.app",
        NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: "mastery.example",
      }),
    ).toBe("https://mastery.example");
  });

  test("uses the deployment URL on Vercel previews", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_VERCEL_ENV: "preview",
        NEXT_PUBLIC_VERCEL_URL: "deployment-abc.vercel.app",
        NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: "mastery.example",
      }),
    ).toBe("https://deployment-abc.vercel.app");
  });

  test("falls back to localhost", () => {
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
  });
});

describe("getAppEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("strips the trailing slash from the site URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mastery.example/");
    const { getAppEnv } = await import("./app-env");

    expect(getAppEnv().NEXT_PUBLIC_SITE_URL).toBe("https://mastery.example");
  });

  test("throws on an invalid site URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a url");
    const { getAppEnv } = await import("./app-env");

    expect(() => getAppEnv()).toThrowError(/NEXT_PUBLIC_SITE_URL/);
  });
});
