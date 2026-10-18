// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { isAdminClient } from "./admin-brand";

vi.mock("server-only", () => ({}));
const createClient = vi.fn(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { createAdminClient } = await import("./admin");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createAdminClient", () => {
  test("uses the secret key, keeps no session and is marked as admin", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");

    const client = createAdminClient();

    expect(createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "sb_secret_x",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
    expect(isAdminClient(client)).toBe(true);
  });

  test("refuses a publishable key as the secret key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_publishable_x");

    expect(() => createAdminClient()).toThrow(/SUPABASE_SECRET_KEY/);
  });
});
