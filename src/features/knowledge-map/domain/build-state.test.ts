import { describe, expect, test } from "vitest";
import { canBuildMap } from "./build-state";

const built = {
  status: "built",
  failureReason: null,
  finishedAt: null,
} as const;

describe("canBuildMap", () => {
  test("allows a build once a Material is parsed", () => {
    expect(canBuildMap(["parsed", "failed", "not_parsed"], null)).toBe(true);
    expect(canBuildMap(["parsed"], built)).toBe(true);
  });

  test.each(["queued", "parsing"] as const)(
    "waits while a Material is %s",
    (status) => {
      expect(canBuildMap(["parsed", status], built)).toBe(false);
    },
  );

  test("needs a parsed Material and no running build", () => {
    expect(canBuildMap(["failed"], null)).toBe(false);
    expect(canBuildMap(["parsed"], { ...built, status: "building" })).toBe(
      false,
    );
  });
});
