import { randomUUID } from "node:crypto";
import { adminClient, expect, seedKc, test } from "./fixtures";

/**
 * A review session from the Today card, with the mock AI (AI_PROVIDER=mock):
 * "Quiz me" makes it ask about the first KC its instructions name, which in
 * a review Chat is the review queue's first KC.
 */

test("Review on the Today card opens a review Chat whose first reply asks on a question card", async ({
  page,
  student,
  course,
}) => {
  await seedKc(student.id, course.id);
  const admin = adminClient();
  const { data: kc } = await admin
    .from("kcs")
    .select("id")
    .eq("course_id", course.id)
    .single();
  // Taught 10 days ago in an ended session, so the KC is due today.
  const taughtAt = new Date(
    Date.now() - 10 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const session = randomUUID();
  const question = randomUUID();
  for (const [table, row] of [
    [
      "study_sessions",
      {
        id: session,
        owner: student.id,
        course_id: course.id,
        mode: "learn",
        started_at: taughtAt,
        ended_at: taughtAt,
      },
    ],
    [
      "questions",
      {
        id: question,
        owner: student.id,
        session_id: session,
        kind: "question",
        prompt: "What is thrust?",
        asked_at: taughtAt,
        answered_at: taughtAt,
        graded_at: taughtAt,
      },
    ],
    ["question_kcs", { question_id: question, kc_id: kc!.id }],
    [
      "attempts",
      {
        owner: student.id,
        question_id: question,
        session_id: session,
        kc_id: kc!.id,
        kind: "learn",
        result: "full",
        help: "none",
        created_at: taughtAt,
      },
    ],
  ] as const) {
    const { error } = await admin
      .from(table as "attempts")
      .insert(row as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  await page.goto(`/courses/${course.id}/map`);
  await page
    .getByRole("region", { name: "Today" })
    .getByRole("link", { name: "Review" })
    .click();
  await expect(page).toHaveURL(`/courses/${course.id}/chat?mode=review`);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Quiz me");
  await message.press("Enter");

  const card = page.getByRole("region", { name: "Question" });
  await expect(card.getByText("Mock question: what is")).toBeVisible();
  await expect(page.getByText("Review · 0 of 1 done")).toBeVisible();

  const { data: sessions } = await admin
    .from("study_sessions")
    .select("mode")
    .eq("course_id", course.id)
    .not("chat_id", "is", null);
  expect(sessions).toEqual([{ mode: "review" }]);
});
