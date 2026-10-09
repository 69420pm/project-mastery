import type { Page } from "@playwright/test";
import {
  adminClient,
  expect,
  openSidebar,
  seedChat,
  seedCourse,
  test,
} from "./fixtures";

const HOUR = 60 * 60 * 1000;

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

/** The ids of a Course's stored Chats. */
async function storedChatIds(courseId: string) {
  const { data, error } = await adminClient()
    .from("chats")
    .select("id")
    .eq("course_id", courseId);
  if (error) throw new Error(`Reading Chats failed: ${error.message}`);
  return data.map((chat) => chat.id);
}

test("opening a Course starts a Chat in it, the sidebar shows only its Chats, and the switcher changes Course", async ({
  page,
  student,
  course,
}) => {
  const biology = await seedCourse(student.id, "Biology");
  await seedChat(student.id, biology.id, {
    firstMessage: "What does a cell wall do?",
    at: new Date(Date.now() - HOUR),
  });

  // Biology was used last, so it leads both Course lists.
  await page.goto("/courses");
  await expect(
    (await openSidebar(page, "Courses")).getByRole("link"),
  ).toHaveText(["Biology", "Calculus"]);
  if (test.info().project.name === "mobile")
    await page.keyboard.press("Escape");
  await page
    .getByRole("list", { name: "Courses" })
    .getByRole("link", { name: "Calculus" })
    .click();

  await expect(page).toHaveURL(course.chatPath);
  await expect(
    (await openSidebar(page)).getByText("No chats yet."),
  ).toBeVisible();
  if (test.info().project.name === "mobile")
    await page.keyboard.press("Escape");

  await messageInput(page).fill("What is a limit?");
  await messageInput(page).press("Enter");
  await expect(
    page.getByRole("log").getByText("it never calls a real model.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect.poll(() => storedChatIds(course.id)).toHaveLength(1);
  const [chatId] = await storedChatIds(course.id);
  await expect(page).toHaveURL(`${course.chatPath}/${chatId}`);

  const chats = await openSidebar(page);
  await expect(chats.getByRole("link")).toHaveText([
    /^(What is a limit\?|Mock reply to)/,
  ]);

  await page.getByRole("button", { name: /Switch course/ }).click();
  await page.getByRole("menuitem", { name: "Biology" }).click();

  await expect(page).toHaveURL(biology.chatPath);
  await expect((await openSidebar(page)).getByRole("link")).toHaveText([
    "What does a cell wall do?",
  ]);

  await page.getByRole("button", { name: /Switch course/ }).click();
  await page.getByRole("menuitem", { name: "All courses" }).click();

  // A message marks its Course as just used.
  await expect(page).toHaveURL("/courses");
  await expect(
    page.getByRole("list", { name: "Courses" }).getByRole("link"),
  ).toHaveText(["Calculus", "Biology"]);
});

test("a Chat of another Course is not found under this one", async ({
  page,
  student,
  course,
}) => {
  const biology = await seedCourse(student.id, "Biology");
  const chatId = await seedChat(student.id, biology.id, {
    firstMessage: "What does a cell wall do?",
    at: new Date(),
  });

  const response = await page.goto(`${course.chatPath}/${chatId}`);

  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("deleting a Course says how many Chats go with it, and deletes them", async ({
  page,
  student,
  course,
}) => {
  for (const firstMessage of ["What is a limit?", "What is a derivative?"]) {
    await seedChat(student.id, course.id, { firstMessage, at: new Date() });
  }
  await page.goto("/courses");

  await page
    .getByRole("list", { name: "Courses" })
    .getByRole("listitem")
    .filter({ hasText: "Calculus" })
    .getByRole("button", { name: "Course actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete course?" });
  await expect(confirm).toContainText(
    "“Calculus” and its 2 chats will be deleted for good.",
  );
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(confirm).toBeHidden();
  await expect(page.getByText("Create your first course")).toBeVisible();
  await expect.poll(() => storedChatIds(course.id)).toEqual([]);
});
