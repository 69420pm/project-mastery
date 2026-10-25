import { adminClient, expect, seedKc, test } from "./fixtures";

/**
 * A graded question on a question card, with the mock AI (AI_PROVIDER=mock):
 * "Quiz me" makes it ask about the Course's first candidate KC, and an
 * answer from the card makes it grade every KC full.
 */

test("the AI asks on a question card, the Student answers there, and the card shows graded", async ({
  page,
  student,
  course,
}) => {
  const { name: kcName } = await seedKc(student.id, course.id);
  await page.goto(course.chatPath);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Quiz me");
  await message.press("Enter");

  const card = page.getByRole("region", { name: "Question" });
  await expect(card.getByText("Mock question: what is")).toBeVisible();
  await expect(card).toHaveAttribute("data-question-state", "open");

  await card.getByRole("textbox", { name: "Your answer" }).fill("It is $4$.");
  // The live preview renders the math.
  await expect(
    card.getByLabel("Preview").locator(".katex").first(),
  ).toBeVisible();
  await card.getByRole("button", { name: "Submit" }).click();

  await expect(card).toHaveAttribute("data-question-state", "graded");
  await expect(card.getByText(kcName)).toBeVisible();
  await expect(card.getByText("Full", { exact: true })).toBeVisible();

  // Stored: the answer on the question, and its attempt.
  const { data: questions } = await adminClient()
    .from("questions")
    .select("answer_text, graded_at, attempts(result)")
    .eq("owner", student.id);
  expect(questions).toEqual([
    {
      answer_text: "It is $4$.",
      graded_at: expect.any(String),
      attempts: [{ result: "full" }],
    },
  ]);

  // Once the feedback has ended and is stored, a reload keeps the card graded.
  await expect(
    page.getByText("it never calls a real model.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit" }).last(),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("region", { name: "Question" })).toHaveAttribute(
    "data-question-state",
    "graded",
  );
});

test("after an answered card, End session makes the Chat read-only and schedules the KC's first review", async ({
  page,
  student,
  course,
}) => {
  const { name: kcName, topicId } = await seedKc(student.id, course.id);
  await page.goto(course.chatPath);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Quiz me");
  await message.press("Enter");
  const card = page.getByRole("region", { name: "Question" });
  await card.getByRole("textbox", { name: "Your answer" }).fill("It is $4$.");
  await card.getByRole("radio", { name: "Confidence 4 of 4" }).click();
  await expect(
    card.getByRole("radio", { name: "Confidence 4 of 4" }),
  ).toBeChecked();
  await card.getByRole("button", { name: "Submit" }).click();
  await expect(card).toHaveAttribute("data-question-state", "graded");
  await expect(
    page.getByText("it never calls a real model.", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: "End session" }).click();

  // The close card takes the composer's place.
  const ended = page.getByRole("region", { name: "Session summary" });
  await expect(ended.getByRole("heading")).toHaveText("Session ended");
  await expect(message).toBeHidden();
  await expect(page.getByRole("button", { name: "End session" })).toBeHidden();
  // Stays read-only on a reload, and opens a new Chat to go on.
  await page.reload();
  await expect(ended.getByRole("heading")).toHaveText("Session ended");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeHidden();
  await ended.getByRole("link", { name: "Start new session" }).click();
  await expect(page).toHaveURL(new RegExp(`${course.chatPath}$`));
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

  // The ended session created the KC's card: its Topic page shows the next
  // review.
  await page.goto(`/courses/${course.id}/map/${topicId}`);
  await page
    .getByRole("application", { name: "Knowledge map graph" })
    .getByRole("button", { name: new RegExp(`^${kcName}`) })
    .first()
    .click();
  await expect(
    page
      .getByLabel("KC details", { exact: true })
      .getByRole("region", { name: "Learning" }),
  ).toContainText("Next review");
});
