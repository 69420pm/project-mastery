import { describe, expect, test } from "vitest";
import { isSidebarOpen } from "./sidebar-state";

function cookies(value?: string) {
  return {
    get: (name: string) =>
      name === "sidebar_state" && value !== undefined ? { value } : undefined,
  };
}

describe("isSidebarOpen", () => {
  test.each([
    [undefined, true],
    ["false", false],
    ["true", true],
  ])("with the cookie set to %s gives %s", (value, open) => {
    expect(isSidebarOpen(cookies(value))).toBe(open);
  });
});
