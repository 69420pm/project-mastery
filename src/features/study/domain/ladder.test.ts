import { describe, expect, test } from "vitest";
import {
  kcState,
  replayLadder,
  type AttemptHelp,
} from "@/features/study/domain/ladder";

const at = (day: string, correct: boolean, help: AttemptHelp = "none") => ({
  createdAt: `${day}T12:00:00.000Z`,
  correct,
  help,
});

describe("replayLadder", () => {
  test("has no position without attempts", () => {
    expect(replayLadder([], null)).toBeNull();
  });

  test("the first attempt teaches the KC at level 1, due the next day, whatever its outcome", () => {
    for (const first of [
      at("2026-10-01", true),
      at("2026-10-01", false),
      at("2026-10-01", true, "solution_shown"),
    ]) {
      expect(replayLadder([first], null)).toEqual({
        level: 1,
        nextReview: "2026-10-02",
      });
    }
  });

  test("before the due day, correct and with help change nothing, and wrong resets", () => {
    const climbed = [at("2026-10-01", true), at("2026-10-02", true)];
    expect(replayLadder(climbed, null)).toEqual({
      level: 2,
      nextReview: "2026-10-05",
    });
    expect(
      replayLadder(
        [...climbed, at("2026-10-03", true), at("2026-10-04", true, "some")],
        null,
      ),
    ).toEqual({ level: 2, nextReview: "2026-10-05" });
    expect(replayLadder([...climbed, at("2026-10-03", false)], null)).toEqual({
      level: 1,
      nextReview: "2026-10-04",
    });
  });

  test("on or after the due day: correct climbs, with help keeps the level, wrong resets", () => {
    const level2 = [at("2026-10-01", true), at("2026-10-02", true)];
    // Due 2026-10-05; reviewed late on the 9th.
    expect(replayLadder([...level2, at("2026-10-09", true)], null)).toEqual({
      level: 3,
      nextReview: "2026-10-16",
    });
    expect(
      replayLadder([...level2, at("2026-10-05", true, "some")], null),
    ).toEqual({ level: 2, nextReview: "2026-10-08" });
    expect(
      replayLadder([...level2, at("2026-10-05", true, "solution_shown")], null),
    ).toEqual({ level: 1, nextReview: "2026-10-06" });
  });

  test("stops at level 5 and replays in time order", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-12"];
    const top = [...days, "2026-01-26", "2026-02-25"].map((day) =>
      at(day, true),
    );
    expect(replayLadder(top.toReversed(), null)).toEqual({
      level: 5,
      nextReview: "2026-03-27",
    });
  });

  test("caps an interval at a quarter of the days to a future exam, and at least 1 day", () => {
    const level3 = [
      at("2026-10-01", true),
      at("2026-10-02", true),
      at("2026-10-05", true),
    ];
    // 7 days at level 3, but 20 days to the exam allow 5.
    expect(replayLadder(level3, "2026-10-25")).toEqual({
      level: 3,
      nextReview: "2026-10-10",
    });
    expect(replayLadder(level3, "2026-10-06")).toEqual({
      level: 3,
      nextReview: "2026-10-06",
    });
    // A past exam caps nothing.
    expect(replayLadder(level3, "2026-09-01")).toEqual({
      level: 3,
      nextReview: "2026-10-12",
    });
  });
});

describe("kcState", () => {
  test("is new, due, known or learning", () => {
    expect(kcState(null, "2026-10-10")).toBe("new");
    expect(kcState({ level: 3, nextReview: "2026-10-10" }, "2026-10-10")).toBe(
      "due",
    );
    expect(kcState({ level: 2, nextReview: "2026-10-11" }, "2026-10-10")).toBe(
      "known",
    );
    expect(kcState({ level: 1, nextReview: "2026-10-11" }, "2026-10-10")).toBe(
      "learning",
    );
  });
});
