import { expect, seedKc, test } from "./fixtures";

/** Ending a Study session in a Chat, with the mock AI (AI_PROVIDER=mock). */

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
