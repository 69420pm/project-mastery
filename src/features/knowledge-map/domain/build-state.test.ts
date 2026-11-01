import { describe, expect, test } from "vitest";
import { buildStoppedReason } from "./build-failure";
import { canBuildMap, withBuildLease } from "./build-state";

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

describe("withBuildLease", () => {
  const building = { ...built, status: "building" } as const;
  const now = Date.parse("2026-10-30T12:00:00Z");

  test("shows a building build silent for 30 minutes as stopped", () => {
    expect(withBuildLease(building, "2026-10-30T11:29:00Z", now)).toEqual({
      ...building,
      status: "failed",
      failureReason: buildStoppedReason,
    });
    expect(withBuildLease(building, "2026-10-30T11:31:00Z", now)).toBe(
      building,
    );
    expect(withBuildLease(built, "2026-10-30T10:00:00Z", now)).toBe(built);
  });
});
