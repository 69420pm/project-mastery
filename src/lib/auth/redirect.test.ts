import { describe, expect, test } from "vitest";
import {
  confirmRedirectPath,
  safeRedirectPath,
  SIGNED_IN_PATH,
} from "./redirect";

const ORIGIN = "http://localhost:3000";

describe("safeRedirectPath", () => {
  test("keeps same-origin paths with query and hash", () => {
    expect(safeRedirectPath("/courses/1?tab=plan#today", ORIGIN)).toBe(
      "/courses/1?tab=plan#today",
    );
  });

  test("turns a same-origin absolute URL into a path", () => {
    expect(safeRedirectPath(`${ORIGIN}/courses`, ORIGIN)).toBe("/courses");
  });

  test.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "http://localhost:3001/",
  ])("falls back for off-site target %s", (target) => {
    expect(safeRedirectPath(target, ORIGIN)).toBe(SIGNED_IN_PATH);
  });

  test("falls back for missing values and uses a custom fallback", () => {
    expect(safeRedirectPath(null, ORIGIN)).toBe(SIGNED_IN_PATH);
    expect(safeRedirectPath("", ORIGIN, "/login")).toBe("/login");
  });
});

describe("confirmRedirectPath", () => {
  test("returns a plain next path", () => {
    expect(confirmRedirectPath("/courses", ORIGIN)).toBe("/courses");
  });

  test("unwraps a next URL that points back at /auth/confirm", () => {
    const next = `${ORIGIN}/auth/confirm?next=%2Fcourses%3Ftab%3Dplan`;
    expect(confirmRedirectPath(next, ORIGIN)).toBe("/courses?tab=plan");
  });

  test("never returns an off-site target from the wrapped next", () => {
    const next = `${ORIGIN}/auth/confirm?next=https%3A%2F%2Fevil.example`;
    expect(confirmRedirectPath(next, ORIGIN)).toBe(SIGNED_IN_PATH);
  });
});
