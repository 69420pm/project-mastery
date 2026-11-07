import { expect, test } from "vitest";
import { sessionEnd } from "./session-end";

test("a session ends at ended_at, or at its newest message once idle for over 2 hours", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const ended = "2026-10-01T11:00:00Z";
  expect(sessionEnd({ endedAt: ended, newestMessageAt: null }, now)).toBe(
    ended,
  );
  expect(
    sessionEnd({ endedAt: null, newestMessageAt: "2026-10-01T09:59:59Z" }, now),
  ).toBe("2026-10-01T09:59:59Z");
  expect(
    sessionEnd({ endedAt: null, newestMessageAt: "2026-10-01T10:00:00Z" }, now),
  ).toBeNull();
  expect(sessionEnd({ endedAt: null, newestMessageAt: null }, now)).toBeNull();
});
