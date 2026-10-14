import { adminClient, expect, test } from "./fixtures";

// The mock AI (AI_PROVIDER=mock) quotes the message and ends with this.
const REPLY_END = "it never calls a real model.";

test.describe("signed in", () => {
  test("opens the Brief with its opening question and keeps the conversation", async ({
    page,
    course,
  }) => {
    await page.goto(`/courses/${course.id}/materials`);
    await page
      .getByRole("link", { name: "Tell the AI about your exam" })
      .click();
    await expect(page).toHaveURL(`/courses/${course.id}/brief`);

    const log = page.getByRole("log");
    await expect(log.getByText("When is it?")).toBeVisible();

    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill("The exam is on 3 December.");
    await input.press("Enter");
    await expect(log.getByText(REPLY_END)).toBeVisible();

    // The reply is stored just as its stream ends.
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("brief_messages")
          .select("id")
          .eq("course_id", course.id)
          .eq("role", "assistant");
        return data?.length;
      })
      .toBe(2);

    await page.reload();
    await expect(log.getByText("When is it?")).toBeVisible();
    await expect(
      log.getByText("The exam is on 3 December.", { exact: true }),
    ).toBeVisible();
    await expect(log.getByText(REPLY_END)).toBeVisible();
  });
});
