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
const request = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.headers),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const { signIn, signOut, signUp } = await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  request.headers = { origin: "http://localhost:3000" };
  cache.revalidatePath.mockClear();
  for (const fn of Object.values(auth)) {
    fn.mockReset();
    fn.mockResolvedValue({ data: {}, error: null });
  }
});

describe("signIn with a password", () => {
  test("signs in with normalized input and redirects to next", async () => {
    await expect(
      signIn(
        null,
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
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  test("never redirects off-site", async () => {
    await expect(
      signIn(
        null,
        form({
          email: "alice@example.com",
          password: "secret",
          next: "https://evil.example",
        }),
      ),
    ).rejects.toThrow(/^redirect:\/courses$/);
  });

  test("returns field errors without calling Supabase", async () => {
    const state = await signIn(
      null,
      form({ email: "not-an-email", password: "" }),
    );

    expect(state).toMatchObject({
      ok: false,
      email: "not-an-email",
      fieldErrors: {
        email: ["Enter a valid email address."],
        password: ["Enter your password."],
      },
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid_credentials", "Email or password is incorrect."],
    [
      "email_not_confirmed",
      "Confirm your email address first. The link is in your inbox.",
    ],
    ["weak_password", "Choose a password with at least 8 characters."],
    [
      "over_request_rate_limit",
      "Too many attempts. Wait a moment and try again.",
    ],
    [
      "over_email_send_rate_limit",
      "Too many attempts. Wait a moment and try again.",
    ],
    ["some_new_code", "Something went wrong. Please try again."],
    [undefined, "Something went wrong. Please try again."],
  ])("returns the message for the error code %s", async (code, message) => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code } });

    const state = await signIn(
      null,
      form({ email: "alice@example.com", password: "wrong" }),
    );

    expect(state).toEqual({ ok: false, message, email: "alice@example.com" });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the origin of email links", () => {
  async function emailRedirectTo() {
    await signUp(
      null,
      form({ email: "alice@example.com", password: "long enough" }),
    );
    return auth.signUp.mock.calls[0]![0].options.emailRedirectTo;
  }

  test("uses the forwarded host and protocol behind a proxy", async () => {
    request.headers = {
      "x-forwarded-host": "mastery.example",
      "x-forwarded-proto": "https",
      host: "internal:3000",
    };
    expect(await emailRedirectTo()).toBe(
      "https://mastery.example/auth/confirm?next=%2Fcourses",
    );
  });

  test("falls back to the host over http", async () => {
    request.headers = { host: "localhost:3000" };
    expect(await emailRedirectTo()).toBe(
      "http://localhost:3000/auth/confirm?next=%2Fcourses",
    );
  });

  test("prefers the origin header", async () => {
    request.headers = {
      origin: "https://app.example",
      "x-forwarded-host": "mastery.example",
      "x-forwarded-proto": "https",
      host: "internal:3000",
    };
    expect(await emailRedirectTo()).toBe(
      "https://app.example/auth/confirm?next=%2Fcourses",
    );
  });
});

describe("signIn with an email link", () => {
  test("emails a sign-in link that returns to next", async () => {
    const state = await signIn(
      null,
      form({
        intent: "link",
        email: "Alice@Example.com",
        password: "",
        next: "/courses",
      }),
    );

    expect(state).toEqual({
      ok: true,
      data: undefined,
      email: "alice@example.com",
    });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "alice@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/confirm?next=%2Fcourses",
      },
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  test("returns the message for rate limits", async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit" },
    });

    const state = await signIn(
      null,
      form({ intent: "link", email: "alice@example.com" }),
    );

    expect(state).toMatchObject({
      ok: false,
      message: "Too many attempts. Wait a moment and try again.",
    });
  });
});

describe("signUp", () => {
  test("sends the confirmation link through /auth/confirm", async () => {
    const state = await signUp(
      null,
      form({
        email: "alice@example.com",
        password: "long enough",
        next: "/courses",
      }),
    );

    expect(state).toEqual({
      ok: true,
      data: undefined,
      email: "alice@example.com",
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "long enough",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/confirm?next=%2Fcourses",
      },
    });
  });

  test("defaults the link target to the signed-in home", async () => {
    await signUp(
      null,
      form({ email: "alice@example.com", password: "long enough" }),
    );

    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          emailRedirectTo: "http://localhost:3000/auth/confirm?next=%2Fcourses",
        },
      }),
    );
  });

  test("requires at least 8 characters", async () => {
    const state = await signUp(
      null,
      form({ email: "alice@example.com", password: "short" }),
    );

    expect(state).toMatchObject({
      ok: false,
      fieldErrors: { password: ["Use at least 8 characters."] },
    });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  test("returns the message for a Supabase error", async () => {
    auth.signUp.mockResolvedValue({
      data: {},
      error: { code: "weak_password" },
    });

    const state = await signUp(
      null,
      form({ email: "alice@example.com", password: "long enough" }),
    );

    expect(state).toEqual({
      ok: false,
      message: "Choose a password with at least 8 characters.",
      email: "alice@example.com",
    });
  });
});

describe("signOut", () => {
  test("signs out and returns to the login page", async () => {
    await expect(signOut()).rejects.toThrow(
      "redirect:/login?message=signed-out",
    );
    expect(auth.signOut).toHaveBeenCalled();
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
