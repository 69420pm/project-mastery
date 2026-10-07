// @vitest-environment node
import { describe, expect, test } from "vitest";
import { sqlIdentity } from "./personas";

describe("sqlIdentity", () => {
  test("resolves anon, personas and emails", () => {
    expect(sqlIdentity("anon")).toEqual({ role: "anon" });
    expect(sqlIdentity("student")).toEqual({
      role: "authenticated",
      email: "student@example.com",
    });
    expect(sqlIdentity("someone@example.com")).toEqual({
      role: "authenticated",
      email: "someone@example.com",
    });
    expect(() => sqlIdentity("teacher")).toThrow('Unknown persona "teacher"');
  });
});
