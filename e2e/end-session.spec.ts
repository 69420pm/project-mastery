import { expect, seedKc, test } from "./fixtures";

/** Ending a Study session in a Chat, with the mock AI (AI_PROVIDER=mock). */

test("a session from the Today card: a question answered in the input is graded, and the close card lists its KC", async ({
  page,
  student,
  course,
}) => {
  await seedKc(student.id, course.id);
  await page.goto(course.chatPath);

  await page
    .getByRole("region", { name: "Today" })
    .getByRole("link", { name: "Let's start." })
    .click();
  await expect(
    page.getByText("it never calls a real model.", { exact: false }),
  ).toBeVisible();

  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();

  // The mock asks on the first KC id of the tutor context.
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Quiz me");
  await message.press("Enter");
  await expect(page.getByTestId("question")).toContainText("what is");
  // The composer sends nothing while a reply streams: wait for its end.
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  await message.fill("4");
  await message.press("Enter");
  await expect(
    page.getByTestId("message-text").filter({ hasText: /^4$/ }),
  ).toBeVisible();
  await expect(
    page.getByText('Mock reply to "4"', { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("checked-today")).toHaveText(
    "Checked today: 1 KC",
  );

  await page.getByRole("button", { name: "End session" }).click();
  const checked = page
    .getByRole("region", { name: "Session summary" })
    .getByRole("list", { name: "KCs checked" })
    .getByRole("listitem");
  await expect(checked).toHaveCount(1);
  await expect(checked).toContainText("Thrust equation");
  await expect(checked).toContainText("Full");
});

test("End session makes the Chat read-only, and Start new session opens a new one", async ({
  page,
  student,
  course,
}) => {
  await seedKc(student.id, course.id);
  await page.goto(course.chatPath);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Hello");
  await message.press("Enter");
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
});
