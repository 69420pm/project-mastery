import type { Page } from "@playwright/test";
import { expect, seedChat, test } from "./fixtures";

const HOUR = 60 * 60 * 1000;

/**
 * The sidebar's Chat list. On a phone the sidebar is a slide-over that opens
 * from the menu button first.
 */
async function openSidebar(page: Page) {
  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
  if (test.info().project.name === "mobile") await toggle.click();
  return page.getByRole("navigation", { name: "Chats" });
}

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

test("the sidebar lists only the Student's own Chats, newest first, and opens one", async ({
  page,
  student,
}) => {
  const now = Date.now();
  const older = await seedChat(student.id, {
    firstMessage: "How do I integrate by parts when both factors are tricky?",
    at: new Date(now - 2 * HOUR),
  });
  await seedChat(student.id, {
    title: "Eigenvalues",
    firstMessage: "What is an eigenvalue?",
    at: new Date(now - HOUR),
  });

  await page.goto("/chat");
  const chats = await openSidebar(page);

  await expect(chats.getByRole("link")).toHaveText([
    "Eigenvalues",
    "How do I integrate by parts when both…",
  ]);

  await chats.getByRole("link", { name: /^How do I integrate/ }).click();

  await expect(page).toHaveURL(`/chat/${older}`);
  await expect(
    page.getByRole("log").getByText(/^How do I integrate by parts/),
  ).toBeVisible();
  if (test.info().project.name === "mobile") {
    // Choosing a Chat closes the slide-over.
    await expect(chats).toBeHidden();
    await openSidebar(page);
  }
  await expect(
    chats.getByRole("link", { name: /^How do I integrate/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    chats.getByRole("link", { name: "Eigenvalues" }),
  ).not.toHaveAttribute("aria-current");
});

test("New chat opens an empty Chat", async ({ page, student }) => {
  const chatId = await seedChat(student.id, {
    firstMessage: "Explain limits",
    at: new Date(),
  });
  await page.goto(`/chat/${chatId}`);
  await openSidebar(page);

  await page.getByRole("link", { name: "New chat" }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(
    page.getByRole("heading", { name: "What are you studying?" }),
  ).toBeVisible();
  await expect(messageInput(page)).toBeVisible();
});

test("a new Chat appears in the list after its first message", async ({
  page,
  student,
}) => {
  await seedChat(student.id, {
    firstMessage: "An earlier Chat",
    at: new Date(Date.now() - HOUR),
  });
  await page.goto("/chat");

  await messageInput(page).fill("What is the derivative of x^3?");
  await messageInput(page).press("Enter");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  // Let the reply end, so it is saved before the Student is deleted.
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();

  const chats = await openSidebar(page);
  await expect(chats.getByRole("link")).toHaveText([
    "What is the derivative of x^3?",
    "An earlier Chat",
  ]);
  await expect(
    chats.getByRole("link", { name: "What is the derivative of x^3?" }),
  ).toHaveAttribute("aria-current", "page");
});

test("the sidebar links to the dashboard and holds the account menu", async ({
  page,
  student,
}) => {
  await page.goto("/chat");
  await openSidebar(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu")).toContainText(student.email);
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
