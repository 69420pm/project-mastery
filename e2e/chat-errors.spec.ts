import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The mock AI (AI_PROVIDER=mock) quotes the message and ends with this.
const REPLY_END = "it never calls a real model.";
const BUSY = "The AI is busy right now. Please try again in a moment.";

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

test("a failed reply shows its error, and Retry answers the message", async ({
  page,
  course,
}) => {
  // The first request fails as a rate-limited reply would; later ones reach
  // the server.
  let failed = false;
  await page.route("**/api/chat", async (route) => {
    if (failed) return route.fallback();
    failed = true;
    await route.fulfill({ status: 429, body: BUSY });
  });
  await page.goto(course.chatPath);

  await messageInput(page).fill("What is a limit?");
  await messageInput(page).press("Enter");

  const log = page.getByRole("log");
  await expect(log.getByText(BUSY)).toBeVisible();
  await log.getByRole("button", { name: "Retry" }).click();

  await expect(log.getByText(REPLY_END, { exact: false })).toBeVisible();
  await expect(log.getByText(BUSY)).toBeHidden();
  // The reply is stored as its stream ends, after its last text shows.
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
  await expect(page).toHaveURL(
    new RegExp(`/courses/${course.id}/chat/[0-9a-f-]{36}$`),
  );
  await page.reload();
  await expect(log.getByTestId("message-text")).toHaveText([
    "What is a limit?",
    /^Mock reply to "What is a limit\?"/,
  ]);
});

test("attaching six files uploads five and says why", async ({
  page,
  course,
}) => {
  const png = readFileSync(
    path.join(
      __dirname,
      "../src/features/ingestion/workflows/test-files/whiteboard.png",
    ),
  );
  await page.goto(course.chatPath);

  await page.locator('input[aria-label="Upload file"]').setInputFiles(
    [1, 2, 3, 4, 5, 6].map((n) => ({
      name: `board-${n}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );

  await expect(
    page.getByRole("alert").filter({ hasText: "Attach up to" }),
  ).toHaveText("Attach up to 5 materials to a message.");
  await expect(page.getByTestId("material-chip")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Remove board-6", exact: true }),
  ).toHaveCount(0);
});
