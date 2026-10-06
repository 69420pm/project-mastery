// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "http://localhost:3000" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const { signInWithMagicLink, signInWithPassword, signOut, signUp } =
  await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  for (const fn of Object.values(auth)) {
    fn.mockReset();
    fn.mockResolvedValue({ data: {}, error: null });
  }
});

describe("signInWithPassword", () => {
  test("signs in with normalized input and redirects to next", async () => {
    await expect(
      signInWithPassword(
        form({
          email: " Alice@Example.com ",
          password: "secret",
          next: "/courses",
        }),
      ),
    ).rejects.toThrow("redirect:/courses");

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "secret",
    });
  });

  test("never redirects off-site", async () => {
    await expect(
      signInWithPassword(
        form({
          email: "alice@example.com",
          password: "secret",
          next: "https://evil.example",
        }),
      ),
    ).rejects.toThrow(/^redirect:\/$/);
  });

  test("rejects invalid input without calling Supabase", async () => {
    await expect(
      signInWithPassword(form({ email: "not-an-email", password: "" })),
    ).rejects.toThrow("redirect:/login?error=invalid-input");

    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  test("maps Supabase errors to a message code and keeps next", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: "invalid_credentials" },
    });

    await expect(
      signInWithPassword(
        form({
          email: "alice@example.com",
          password: "wrong",
          next: "/courses",
        }),
      ),
    ).rejects.toThrow(
      "redirect:/login?error=invalid-credentials&next=%2Fcourses",
    );
  });
});

describe("signUp", () => {
  test("sends the confirmation link through /auth/confirm", async () => {
    await expect(
      signUp(
        form({
          email: "alice@example.com",
          password: "long enough",
          next: "/courses",
        }),
      ),
    ).rejects.toThrow("redirect:/login?message=check-email");

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "long enough",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/confirm?next=%2Fcourses",
      },
    });
  });

  test("requires at least 8 characters", async () => {
    await expect(
      signUp(form({ email: "alice@example.com", password: "short" })),
    ).rejects.toThrow("redirect:/login?error=invalid-input");

    expect(auth.signUp).not.toHaveBeenCalled();
  });
});

describe("signInWithMagicLink", () => {
  test("emails a sign-in link that returns to next", async () => {
    await expect(
      signInWithMagicLink(form({ email: "alice@example.com" })),
    ).rejects.toThrow("redirect:/login?message=check-email");

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "alice@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/confirm?next=%2F",
      },
    });
  });

  test("reports rate limits", async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit" },
    });

    await expect(
      signInWithMagicLink(form({ email: "alice@example.com" })),
    ).rejects.toThrow("redirect:/login?error=rate-limited");
  });
});

describe("signOut", () => {
  test("signs out and returns to the login page", async () => {
    await expect(signOut()).rejects.toThrow(
      "redirect:/login?message=signed-out",
    );
    expect(auth.signOut).toHaveBeenCalled();
  });
});
