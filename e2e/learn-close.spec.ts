import { adminClient, expect, seedKc, test } from "./fixtures";

/**
 * A learn session's rebuild and close, with the mock AI (AI_PROVIDER=mock):
 * "Rebuild with me" makes it ask a rebuild question, and grading the answer
 * moves the session to close.
 */
test("a graded rebuild opens the Topic map, and the close card saves a rating", async ({
  page,
  student,
  course,
}) => {
  const { name: kcName } = await seedKc(student.id, course.id);
  await page.goto(course.chatPath);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Rebuild with me");
  await message.press("Enter");
  const question = page.getByRole("region", { name: "Question" });
  await expect(question.getByText("Mock rebuild")).toBeVisible();
  await question
    .getByRole("textbox", { name: "Your answer" })
    .fill("Thrust is mass flow times the change in velocity.");
  await question.getByRole("button", { name: "Submit" }).click();

  // The grade's Topic map card opens the Topic's graph on its own: beside
  // the conversation when wide, in a Sheet over it on a phone.
  const slot = page
    .getByRole("complementary", { name: "Source" })
    .or(page.getByRole("region", { name: "Source" }));
  await expect(slot.getByRole("heading", { name: "Topic map" })).toBeVisible();
  await expect(
    slot
      .getByRole("application", { name: "Knowledge map graph" })
      .getByRole("button", { name: new RegExp(`^${kcName}`) }),
  ).toBeVisible();
  await slot.getByRole("button", { name: "Close source" }).click();
  await expect(page.getByRole("region", { name: "Topic map" })).toBeVisible();

  // At close, the close card takes the composer's place.
  const close = page.getByRole("region", { name: "Session summary" });
  await expect(close).toBeVisible();
  await expect(message).toBeHidden();
  await expect(
    page
      .getByRole("navigation", { name: "Session stages" })
      .locator('[aria-current="step"]'),
  ).toHaveText("Close");
  await expect(
    close.getByRole("list", { name: "KCs practised" }),
  ).toContainText(`${kcName}`);
  await expect(close).toContainText("Next review");

  await close.getByRole("radio", { name: "Rating 4 of 5" }).click();
  await close.getByRole("textbox", { name: "Note" }).fill("Clear.");
  await close.getByRole("button", { name: "Save rating" }).click();
  await expect(close.getByText("Rating saved")).toBeVisible();
  await expect(close.getByRole("heading")).toHaveText("Session ended");
  await expect(
    close.getByRole("link", { name: "Start new session" }),
  ).toBeVisible();

  const { data: sessions } = await adminClient()
    .from("study_sessions")
    .select("stage, rating, rating_note, ended_at")
    .eq("owner", student.id);
  expect(sessions).toEqual([
    {
      stage: "close",
      rating: 4,
      rating_note: "Clear.",
      ended_at: expect.any(String),
    },
  ]);
});
