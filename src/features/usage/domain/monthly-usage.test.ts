import { describe, expect, test } from "vitest";
import { monthlyUsage, utcMonthStart } from "./monthly-usage";

const algebra = { id: "course-a", name: "Algebra" };
const biology = { id: "course-b", name: "Biology" };

describe("monthlyUsage", () => {
  test("sums Student tasks into Study, against 60% of the $5 credit", () => {
    const usage = monthlyUsage([
      { task: "chat", costUsd: 0.5, course: algebra },
      { task: "ingest", costUsd: 0.25, course: null },
      { task: "topic", costUsd: 0.25, course: null },
    ]);
    expect(usage.buckets).toEqual([
      { bucket: "study", label: "Study", spentUsd: 1, budgetUsd: 3 },
      {
        bucket: "generation",
        label: "Generation",
        spentUsd: 0,
        budgetUsd: 0.75,
      },
    ]);
    expect(usage.totalUsd).toBe(1);
    expect(usage.otherUsd).toBe(0);
  });

  test("keeps tasks outside both buckets apart", () => {
    const usage = monthlyUsage([
      { task: "retired", costUsd: 0.1, course: null },
    ]);
    expect(usage.otherUsd).toBe(0.1);
    expect(usage.buckets.every(({ spentUsd }) => spentUsd === 0)).toBe(true);
  });

  test("breaks spend down by Course, spend outside Chats last", () => {
    const usage = monthlyUsage([
      { task: "map", costUsd: 2, course: null },
      { task: "chat", costUsd: 0.1, course: algebra },
      { task: "chat", costUsd: 0.3, course: biology },
      { task: "title", costUsd: 0.1, course: algebra },
    ]);
    expect(usage.courses).toEqual([
      { courseId: "course-b", name: "Biology", spentUsd: 0.3 },
      { courseId: "course-a", name: "Algebra", spentUsd: 0.2 },
      { courseId: null, name: "Outside Chats", spentUsd: 2 },
    ]);
  });

  test("a month without spend has no Courses", () => {
    expect(monthlyUsage([]).courses).toEqual([]);
  });
});

test("the month starts at 00:00 UTC on its first day", () => {
  expect(utcMonthStart(new Date("2026-10-23T23:59:00-05:00"))).toEqual(
    new Date("2026-10-01T00:00:00Z"),
  );
  expect(utcMonthStart(new Date("2026-11-01T00:30:00+02:00"))).toEqual(
    new Date("2026-10-01T00:00:00Z"),
  );
});
