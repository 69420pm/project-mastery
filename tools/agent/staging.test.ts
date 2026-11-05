import { describe, expect, it, vi } from "vitest";
import { AgentError } from "./config";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  queryStaging,
  stagingEnv,
  stagingRequestUrl,
} from "./staging";

const BASE = "https://abcd1234.supabase.co";
const ENV = {
  STAGING_SUPABASE_URL: `${BASE}/`,
  STAGING_SUPABASE_SECRET_KEY: "sb_secret_test",
};

describe("stagingEnv", () => {
  it("reads both variables and drops a trailing slash from the URL", () => {
    expect(stagingEnv(ENV)).toEqual({
      url: BASE,
      secretKey: "sb_secret_test",
    });
  });

  it("names the variables that are missing", () => {
    expect(() => stagingEnv({ STAGING_SUPABASE_URL: BASE })).toThrow(
      /STAGING_SUPABASE_SECRET_KEY/,
    );
  });

  it("refuses a URL without https", () => {
    expect(() =>
      stagingEnv({
        STAGING_SUPABASE_URL: "http://127.0.0.1:54321",
        STAGING_SUPABASE_SECRET_KEY: "sb_secret_test",
      }),
    ).toThrow(AgentError);
  });
});

describe("stagingRequestUrl", () => {
  it("adds the default limit to a table query", () => {
    const url = stagingRequestUrl(BASE, "materials?select=id,title");
    expect(url.pathname).toBe("/rest/v1/materials");
    expect(url.searchParams.get("select")).toBe("id,title");
    expect(url.searchParams.get("limit")).toBe(String(DEFAULT_LIMIT));
  });

  it("keeps an explicit limit", () => {
    const url = stagingRequestUrl(BASE, "chats?limit=5");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it.each([
    "rpc/set_chunk_embeddings",
    "materials/123",
    "materials?limit=0",
    `materials?limit=${MAX_LIMIT + 1}`,
    "materials?limit=ten",
    "Materials",
    "",
    "chats; drop table chats",
  ])("refuses %j", (input) => {
    expect(() => stagingRequestUrl(BASE, input)).toThrow(AgentError);
  });
});

describe("queryStaging", () => {
  it("sends one GET with the secret key and returns the rows as one line", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('[\n  {"id": 1}\n]', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const output = await queryStaging("chats?select=id", ENV, fetchFn);

    expect(output).toBe('[{"id":1}]');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [requested, init] = fetchFn.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(requested.toString()).toBe(
      `${BASE}/rest/v1/chats?select=id&limit=${DEFAULT_LIMIT}`,
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ apikey: "sb_secret_test" });
  });

  it("reports the status and body of a failed request without the key", async () => {
    const fetchFn = vi.fn(
      async () => new Response('{"message":"no such table"}', { status: 404 }),
    );
    const error = await queryStaging("nope", ENV, fetchFn).catch((e) => e);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.message).toContain("404");
    expect(error.message).toContain("no such table");
    expect(error.message).not.toContain("sb_secret_test");
  });
});
