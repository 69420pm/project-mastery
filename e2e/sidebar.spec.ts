import type { Page } from "@playwright/test";
import { expect, openSidebar, seedChat, test } from "./fixtures";

const HOUR = 60 * 60 * 1000;

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

test("the sidebar lists only the Student's own Chats, newest first, and opens one", async ({
  page,
  student,
  course,
}) => {
  const now = Date.now();
  const older = await seedChat(student.id, course.id, {
    firstMessage: "How do I integrate by parts when both factors are tricky?",
    at: new Date(now - 2 * HOUR),
  });
  await seedChat(student.id, course.id, {
    title: "Eigenvalues",
    firstMessage: "What is an eigenvalue?",
    at: new Date(now - HOUR),
  });

  await page.goto(course.chatPath);
  const chats = await openSidebar(page);

  await expect(chats.getByRole("link")).toHaveText([
    "Eigenvalues",
    "How do I integrate by parts when both…",
  ]);

  await chats.getByRole("link", { name: /^How do I integrate/ }).click();

  await expect(page).toHaveURL(`${course.chatPath}/${older}`);
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

test("New chat opens an empty Chat", async ({ page, student, course }) => {
  const chatId = await seedChat(student.id, course.id, {
    firstMessage: "Explain limits",
    at: new Date(),
  });
  await page.goto(`${course.chatPath}/${chatId}`);
  await openSidebar(page);

  await page.getByRole("link", { name: "New chat" }).click();

  await expect(page).toHaveURL(course.chatPath);
  await expect(
    page.getByRole("heading", { name: "Ready to study?" }),
  ).toBeVisible();
  await expect(messageInput(page)).toBeVisible();
});

test("a new Chat appears in the list with its first message, then gets a title after the reply", async ({
  page,
  student,
  course,
}) => {
  await seedChat(student.id, course.id, {
    firstMessage: "An earlier Chat",
    at: new Date(Date.now() - HOUR),
  });
  await page.goto(course.chatPath);

  await messageInput(page).fill("What is the derivative of x^3?");
  await messageInput(page).press("Enter");
  await expect(page).toHaveURL(new RegExp(`${course.chatPath}/[0-9a-f-]{36}$`));
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
    `${course.chatPath}/${chatId}`,
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
  course,
}) => {
  await page.goto(course.chatPath);
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

test("on a phone, the logo closes the slide-over even on the page it leads to", async ({
  page,
  course,
}) => {
  test.skip(test.info().project.name !== "mobile", "A phone-only slide-over.");
  await page.goto("/courses");
  const courses = await openSidebar(page, "Courses");
  await expect(courses.getByRole("link", { name: course.name })).toBeVisible();

  await page.getByRole("link", { name: "Project Mastery" }).click();

  await expect(courses).toBeHidden();
  await expect(page).toHaveURL(/\/courses$/);
});

test("a collapsed sidebar stays collapsed after a reload", async ({
  page,
  course,
}) => {
  test.skip(
    test.info().project.name === "mobile",
    "On a phone the sidebar is a slide-over that starts closed.",
  );
  await page.goto(course.chatPath);
  const logo = page.getByRole("link", { name: "Project Mastery" });
  await expect(logo).toBeInViewport();

  await page.locator('[data-sidebar="trigger"]').click();
  await expect(logo).not.toBeInViewport();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(logo).not.toBeInViewport();
});
