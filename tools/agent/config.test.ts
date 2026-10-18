// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentError, readTomlPorts, supabaseEnv } from "./config";

const fs = vi.hoisted(() => ({ toml: "" }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync: () => fs.toml,
}));

describe("readTomlPorts", () => {
  test("reads the first port of each section", () => {
    const toml = [
      "[api]",
      "port = 54321",
      "[db]",
      "port = 54322",
      "shadow_port = 54320",
      "[db.pooler]",
      "port = 54329",
    ].join("\n");
    expect(readTomlPorts(toml)).toEqual({
      api: 54321,
      db: 54322,
      "db.pooler": 54329,
    });
  });
});

describe("supabaseEnv", () => {
  beforeEach(() => {
    fs.toml = "";
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  test.each(["https://abc.supabase.co", "http://10.0.0.5:54321"])(
    "refuses the non-local host %s",
    (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(supabaseEnv).toThrow(AgentError);
      expect(supabaseEnv).toThrow(/only works against the local stack/);
    },
  );

  test("names a missing variable", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", undefined);
    expect(supabaseEnv).toThrow(AgentError);
    expect(supabaseEnv).toThrow(/SUPABASE_SECRET_KEY/);
  });

  test.each(["http://127.0.0.1:54321/", "http://localhost:54321"])(
    "accepts %s and falls back to the default ports",
    (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(supabaseEnv()).toEqual({
        url: url.replace(/\/$/, ""),
        publishableKey: "publishable",
        secretKey: "secret",
        dbUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        mailUrl: "http://127.0.0.1:54324",
        studioUrl: "http://127.0.0.1:54323",
      });
    },
  );

  test("takes the ports from supabase/config.toml", () => {
    fs.toml = "[db]\nport = 1\n[studio]\nport = 2\n[inbucket]\nport = 3\n";
    expect(supabaseEnv()).toMatchObject({
      dbUrl: "postgresql://postgres:postgres@127.0.0.1:1/postgres",
      studioUrl: "http://127.0.0.1:2",
      mailUrl: "http://127.0.0.1:3",
    });
    fs.toml += "[local_smtp]\nport = 4\n";
    expect(supabaseEnv().mailUrl).toBe("http://127.0.0.1:4");
  });
});
