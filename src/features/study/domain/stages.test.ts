import { expect, test } from "vitest";
import { stageMoveRefusal, startStage } from "@/features/study/domain/stages";

test("a session starts at review when reviews are due, else resumes where the Topic's last session stopped", () => {
  expect(startStage(null, false)).toBe("orient");
  expect(startStage("work", false)).toBe("work");
  expect(startStage("close", false)).toBe("orient");
  expect(startStage("review", false)).toBe("orient");
  expect(startStage("work", true)).toBe("review");
});

const move = { afterReview: "orient", readingLeft: false } as const;

test("setStage allows the next stage, work back to read while reading is left, and review to the named stage", () => {
  expect(stageMoveRefusal({ ...move, from: "orient", to: "prime" })).toBeNull();
  expect(
    stageMoveRefusal({ ...move, from: "work", to: "read", readingLeft: true }),
  ).toBeNull();
  expect(
    stageMoveRefusal({
      ...move,
      from: "review",
      to: "work",
      afterReview: "work",
    }),
  ).toBeNull();
});

test("setStage needs a reason to skip ahead", () => {
  const skip = { ...move, from: "orient", to: "work" } as const;
  expect(stageMoveRefusal(skip)).toContain("give a one-line reason");
  expect(stageMoveRefusal({ ...skip, reason: " " })).not.toBeNull();
  expect(
    stageMoveRefusal({ ...skip, reason: "The Student knows the reading." }),
  ).toBeNull();
});

test("setStage refuses moving back and leaving close, even with a reason", () => {
  const reason = "Because.";
  expect(
    stageMoveRefusal({ ...move, from: "apply", to: "work", reason }),
  ).toContain("never moves back");
  expect(
    stageMoveRefusal({ ...move, from: "work", to: "read", reason }),
  ).toContain("nothing left to read");
  expect(
    stageMoveRefusal({ ...move, from: "close", to: "rebuild", reason }),
  ).toContain("stays there");
});
