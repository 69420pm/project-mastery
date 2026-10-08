import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The mock AI (AI_PROVIDER=mock) quotes the message and ends with this.
const REPLY_END = "it never calls a real model.";

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

async function sendMessage(page: Page, text: string) {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
}

test.describe("signed in", () => {
  // Every test here runs as a fresh, signed-in Student.
  test.beforeEach(({ student }) => {
    test
      .info()
      .annotations.push({ type: "student", description: student.email });
  });

  test("a first message creates a Chat, streams the reply and keeps the history", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(
      page.getByRole("heading", { name: "What are you studying?" }),
    ).toBeVisible();

    await sendMessage(page, "What is $x^2$ for x = 3?");

    const log = page.getByRole("log");
    await expect(log.getByText("What is $x^2$ for x = 3?")).toBeVisible();
    // The reply streams in: its beginning shows before its end.
    await expect(log.getByText(/Mock reply to/)).toBeVisible();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    await expect(log.getByText(REPLY_END, { exact: false })).toBeVisible();
    // The quoted message renders its math with KaTeX.
    await expect(log.locator(".katex").first()).toBeVisible();
    const chatUrl = page.url();

    // The input refuses a submit until the reply has fully settled.
    await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
    await sendMessage(page, "And for x = 4?");
    await expect(
      log.getByText(/Mock reply to "And for x = 4\?"/),
    ).toBeVisible();
    await expect(log.getByText(REPLY_END, { exact: false })).toHaveCount(2);

    await page.reload();

    expect(page.url()).toBe(chatUrl);
    await expect(log.locator(".is-user, .is-assistant")).toHaveText([
      "What is $x^2$ for x = 3?",
      /^Mock reply to "What is/,
      "And for x = 4?",
      /^Mock reply to "And for x = 4\?"/,
    ]);
  });

  test("a message over 10,000 characters is refused in the input", async ({
    page,
  }) => {
    await page.goto("/chat");

    await sendMessage(page, "x".repeat(10_001));

    await expect(messageInput(page)).toHaveAccessibleDescription(
      "Your message is too long. Keep it under 10,000 characters.",
    );
    await expect(messageInput(page)).toHaveValue("x".repeat(10_001));
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("an unknown Chat shows not-found", async ({ page }) => {
    const response = await page.goto(`/chat/${randomUUID()}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });
});

test("signed out, /chat redirects to sign-in and returns there afterwards", async ({
  page,
  context,
  student,
}) => {
  await context.clearCookies();

  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login\?next=%2Fchat$/);

  await page.getByLabel("Email").fill(student.email);
  await page.getByLabel("Password").fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).last().click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(messageInput(page)).toBeVisible();
});
