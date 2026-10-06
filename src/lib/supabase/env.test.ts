// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getSupabasePublicEnv,
  isSupabaseConfigured,
  supabasePublicEnvSchema,
  supabaseSecretEnvSchema,
} from "./env";

/** A legacy Supabase API key: an unsigned-for-test JWT with a role claim. */
function legacyKey(role: string) {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.signature`;
}

const LOCAL_URL = "http://127.0.0.1:54321";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supabasePublicEnvSchema", () => {
  const parse = (url: string, key: string) =>
    supabasePublicEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    }).success;

  test("accepts a publishable key and the local CLI URL", () => {
    expect(parse(LOCAL_URL, "sb_publishable_example")).toBe(true);
  });

  test("accepts a hosted project URL", () => {
    expect(
      parse("https://abcdefgh.supabase.co", "sb_publishable_example"),
    ).toBe(true);
  });

  test("accepts a legacy anon key", () => {
    expect(parse(LOCAL_URL, legacyKey("anon"))).toBe(true);
  });

  test("rejects keys that must stay on the server", () => {
    expect(parse(LOCAL_URL, "sb_secret_example")).toBe(false);
    expect(parse(LOCAL_URL, legacyKey("service_role"))).toBe(false);
  });

  test("rejects malformed values", () => {
    expect(parse("127.0.0.1:54321", "sb_publishable_example")).toBe(false);
    expect(parse("ftp://example.com", "sb_publishable_example")).toBe(false);
    expect(parse(LOCAL_URL, "")).toBe(false);
    expect(parse(LOCAL_URL, "eyJnot-a-jwt")).toBe(false);
  });
});

describe("supabaseSecretEnvSchema", () => {
  const parse = (key: string) =>
    supabaseSecretEnvSchema.safeParse({ SUPABASE_SECRET_KEY: key }).success;

  test("accepts a secret key or a legacy service_role key", () => {
    expect(parse("sb_secret_example")).toBe(true);
    expect(parse(legacyKey("service_role"))).toBe(true);
  });

  test("rejects publishable and anon keys", () => {
    expect(parse("sb_publishable_example")).toBe(false);
    expect(parse(legacyKey("anon"))).toBe(false);
  });
});

describe("getSupabasePublicEnv", () => {
  test("returns the validated variables", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_example",
    );

    expect(getSupabasePublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    });
  });

  test("lists every missing variable in one error", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);

    expect(() => getSupabasePublicEnv()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });
});

describe("isSupabaseConfigured", () => {
  test("is true only when both public variables are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);

    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_example",
    );
    expect(isSupabaseConfigured()).toBe(true);
  });
});
