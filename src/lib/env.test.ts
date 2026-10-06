import { describe, expect, test } from "vitest";
import { z } from "zod";
import { parseEnv } from "./env";

const schema = z.object({
  API_URL: z.url(),
  API_KEY: z.string().min(1),
  RETRIES: z.coerce.number().int().default(3),
});

describe("parseEnv", () => {
  test("returns typed values with coercion and defaults applied", () => {
    const env = parseEnv(schema, {
      API_URL: "https://example.com",
      API_KEY: "key",
    });

    expect(env).toEqual({
      API_URL: "https://example.com",
      API_KEY: "key",
      RETRIES: 3,
    });
  });

  test("ignores variables the schema does not declare", () => {
    const env = parseEnv(schema, {
      API_URL: "https://example.com",
      API_KEY: "key",
      UNRELATED: "value",
    });

    expect(env).not.toHaveProperty("UNRELATED");
  });

  test("throws one error that lists every invalid variable", () => {
    expect(() =>
      parseEnv(schema, { API_URL: "not-a-url", RETRIES: "1.5" }),
    ).toThrowError(
      /^Invalid environment variables:\n {2}API_URL: .+\n {2}API_KEY: .+\n {2}RETRIES: .+$/,
    );
  });
});
