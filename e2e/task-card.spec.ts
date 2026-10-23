import { adminClient, expect, test } from "./fixtures";

/**
 * A graded question on a task card, with the mock AI (AI_PROVIDER=mock):
 * "Quiz me" makes it ask about the Course's first candidate KC, and an
 * answer from the card makes it grade every KC full.
 */

/** Stores a one-KC Knowledge map in the Course; returns the KC's name. */
async function seedKc(owner: string, courseId: string): Promise<string> {
  const admin = adminClient();
  const owned = { owner, course_id: courseId };
  const bigIdea = await admin
    .from("big_ideas")
    .insert({ ...owned, name: "Thrust", description: "Thrust.", position: 0 })
    .select("id")
    .single();
  if (bigIdea.error) throw new Error(bigIdea.error.message);
  const name = "Thrust equation";
  const kc = await admin.from("kcs").insert({
    ...owned,
    big_idea_id: bigIdea.data.id,
    name,
    description: "Thrust is mass flow times the change in velocity.",
    type: "procedure",
    bloom: "apply",
    origin: "content",
    position: 0,
  });
  if (kc.error) throw new Error(kc.error.message);
  return name;
}

test("the AI asks on a task card, the Student answers there, and the card shows graded", async ({
  page,
  student,
  course,
}) => {
  const kcName = await seedKc(student.id, course.id);
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
