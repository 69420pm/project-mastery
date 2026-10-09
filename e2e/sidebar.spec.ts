import type { Page } from "@playwright/test";
import { expect, openSidebar, seedChat, test } from "./fixtures";

const HOUR = 60 * 60 * 1000;

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

test("a new Chat appears in the list with its first message, then gets a title after the reply", async ({
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
  const chatId = page.url().split("/").at(-1);

  // The mock reply takes seconds to stream, so the list still shows the
  // first message.
  const chats = await openSidebar(page);
  await expect(chats.getByRole("link")).toHaveText([
    "What is the derivative of x^3?",
    "An earlier Chat",
  ]);
  await expect(chats.getByRole("link").first()).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The mock AI's title quotes the message, shortened.
  const title = /^Mock reply to "What is the derivative of x\^3\?"/;
  await expect(chats.getByRole("link").first()).toHaveText(title);
  await expect(chats.getByRole("link").first()).toHaveAttribute(
    "href",
    `/chat/${chatId}`,
  );

  await page.reload();
  await expect((await openSidebar(page)).getByRole("link")).toHaveText([
    title,
    "An earlier Chat",
  ]);
});

test("the sidebar's logo leads to the Course list, and it holds the account menu", async ({
  page,
  student,
}) => {
  await page.goto("/chat");
  await openSidebar(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu")).toContainText(student.email);
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Project Mastery" }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Courses" }),
  ).toBeVisible();
});
