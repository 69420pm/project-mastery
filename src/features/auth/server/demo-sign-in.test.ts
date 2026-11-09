// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = { signInWithPassword: vi.fn() };
const getCourseList = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));
vi.mock("@/features/courses", () => ({ COURSE_LIST_PATH: "/courses" }));
vi.mock("@/features/courses/server", () => ({ getCourseList }));
vi.mock("@/features/knowledge-map/server", () => ({
  courseMapPath: (id: string) => `/courses/${id}/map`,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

const { signInDemo } = await import("./demo-sign-in");

beforeEach(() => {
  vi.stubEnv("DEMO_EMAIL", "demo@example.com");
  vi.stubEnv("DEMO_PASSWORD", "demo-password");
  auth.signInWithPassword.mockReset().mockResolvedValue({ error: null });
  getCourseList.mockReset().mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signInDemo", () => {
  test("signs into the demo account and opens its latest Course's map", async () => {
    await expect(signInDemo()).rejects.toThrow(/^redirect:\/courses\/c1\/map$/);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "demo@example.com",
      password: "demo-password",
    });
  });

  test("opens the Course list when the demo account has no Course", async () => {
    getCourseList.mockResolvedValue([]);
    await expect(signInDemo()).rejects.toThrow(/^redirect:\/courses$/);
  });

  test.each([
    ["no email", "", "demo-password"],
    ["no password", "demo@example.com", ""],
  ])("is not found with %s set", async (_case, email, password) => {
    vi.stubEnv("DEMO_EMAIL", email);
    vi.stubEnv("DEMO_PASSWORD", password);
    await expect(signInDemo()).rejects.toThrow("notFound");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  test("sends a failed sign-in to the login page", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: new Error("bad") });
    await expect(signInDemo()).rejects.toThrow(
      /^redirect:\/login\?message=unexpected$/,
    );
    expect(getCourseList).not.toHaveBeenCalled();
  });
});
