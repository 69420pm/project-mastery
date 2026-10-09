import type { Page } from "@playwright/test";
import { expect, seedAiSpend, test } from "./fixtures";

// The Playwright server runs with AI_DAILY_LIMIT_USD=1 (playwright.config.ts),
// and a mock reply costs about $0.00005.

const WARNING = "You've used most of today's daily limit.";

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

/** No dollar amount ever reaches the Student. */
async function expectNoDollarAmounts(page: Page) {
  await expect(page.locator("body")).not.toContainText("$");
  await expect(page.locator("body")).not.toContainText(/USD|dollar/i);
}

test("below 80% of the Daily limit the Chat shows no notice", async ({
  page,
  student,
  course,
}) => {
  await seedAiSpend(student, 0.5);

  await page.goto(course.chatPath);

  await expect(messageInput(page)).toBeEditable();
  await expect(page.getByText(WARNING)).toHaveCount(0);
});

test("from 80% of the Daily limit the Chat shows a notice and keeps the input open", async ({
  page,
  student,
  course,
}) => {
  await seedAiSpend(student, 0.85);

  await page.goto(course.chatPath);

  await expect(page.getByText(WARNING)).toBeVisible();
  await expect(messageInput(page)).toBeEditable();
  await expectNoDollarAmounts(page);
});

test.describe("at the Daily limit", () => {
  // 00:00 UTC is 5:30 AM in India, which has no daylight saving time.
  test.use({ timezoneId: "Asia/Kolkata", locale: "en-US" });

  test("the input is disabled and shows the reset in local time", async ({
    page,
    student,
    course,
  }) => {
    await seedAiSpend(student, 1);

    await page.goto(course.chatPath);

    await expect(
      page.getByText(
        "You've reached today's daily limit. It resets at 5:30 AM.",
      ),
    ).toBeVisible();
    await expect(messageInput(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Submit" })).toBeDisabled();
    await expectNoDollarAmounts(page);
  });

  test("a reply that reaches the limit finishes, then the input is disabled", async ({
    page,
    student,
    course,
  }) => {
    await seedAiSpend(student, 0.99996);
    await page.goto(course.chatPath);
    await expect(page.getByText(WARNING)).toBeVisible();

    await messageInput(page).fill("One last question");
    await messageInput(page).press("Enter");

    await expect(
      page.getByRole("log").getByText("it never calls a real model.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "You've reached today's daily limit. It resets at 5:30 AM.",
      ),
    ).toBeVisible();
    await expect(messageInput(page)).toBeDisabled();
  });
});
