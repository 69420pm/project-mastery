import { expect, test } from "vitest";
import { joinAnswer, MAX_ANSWER_TEXT } from "@/features/study/domain/answers";

test("joins the Student's messages in order, a blank line apart", () => {
  const first = joinAnswer(null, "Mass flow.");
  expect(joinAnswer(first, "Times velocity.")).toBe(
    "Mass flow.\n\nTimes velocity.",
  );
});

test("cuts a long answer at the column's limit", () => {
  const long = joinAnswer("a".repeat(MAX_ANSWER_TEXT - 1), "more");
  expect(long).toHaveLength(MAX_ANSWER_TEXT);
  expect(long.startsWith("a")).toBe(true);
});
