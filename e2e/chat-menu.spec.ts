import type { Locator, Page } from "@playwright/test";
import { expect, openSidebar, seedChat, test } from "./fixtures";

const HOUR = 60 * 60 * 1000;

/** Opens the "…" menu of the listed Chat named `label`. */
async function openChatMenu(chats: Locator, label: string) {
  await chats
    .getByRole("listitem")
    .filter({ has: chats.page().getByRole("link", { name: label }) })
    .getByRole("button", { name: "Chat actions" })
    .click();
  return chats.page().getByRole("menu");
}

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

test("Rename names a Chat for good", async ({ page, student }) => {
  const chatId = await seedChat(student.id, {
    firstMessage: "What is a limit?",
    at: new Date(),
  });
  await page.goto(`/chat/${chatId}`);
  const chats = await openSidebar(page);

  const menu = await openChatMenu(chats, "What is a limit?");
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename chat" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "What is a limit?",
  );
  await dialog.getByRole("textbox", { name: "Title" }).fill("Limits revision");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog).toBeHidden();
  await expect(chats.getByRole("link")).toHaveText(["Limits revision"]);

  // A reply in the renamed Chat does not retitle it.
  if (test.info().project.name === "mobile")
    await page.keyboard.press("Escape");
  await messageInput(page).fill("And a limit at infinity?");
  await messageInput(page).press("Enter");
  await expect(
    page.getByRole("log").getByText(/^Mock reply to "And/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();

  await page.reload();
  await expect((await openSidebar(page)).getByRole("link")).toHaveText([
    "Limits revision",
  ]);
});

test("Delete asks for confirmation, then removes the Chat for good", async ({
  page,
  student,
}) => {
  const open = await seedChat(student.id, {
    firstMessage: "Open Chat",
    at: new Date(),
  });
  const other = await seedChat(student.id, {
    firstMessage: "Chat to delete",
    at: new Date(Date.now() - HOUR),
  });
  await page.goto(`/chat/${open}`);
  const chats = await openSidebar(page);

  await (
    await openChatMenu(chats, "Chat to delete")
  )
    .getByRole("menuitem", { name: "Delete" })
    .click();
  const confirm = page.getByRole("alertdialog", { name: "Delete chat?" });
  await expect(confirm).toContainText("Chat to delete");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(chats.getByRole("link")).toHaveText([
    "Open Chat",
    "Chat to delete",
  ]);

  await (
    await openChatMenu(chats, "Chat to delete")
  )
    .getByRole("menuitem", { name: "Delete" })
    .click();
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(confirm).toBeHidden();
  await expect(chats.getByRole("link")).toHaveText(["Open Chat"]);
  await expect(page).toHaveURL(`/chat/${open}`);

  await page.goto(`/chat/${other}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("deleting the open Chat lands on a new Chat", async ({
  page,
  student,
}) => {
  const chatId = await seedChat(student.id, {
    firstMessage: "Open Chat",
    at: new Date(),
  });
  await page.goto(`/chat/${chatId}`);
  const chats = await openSidebar(page);

  await (
    await openChatMenu(chats, "Open Chat")
  )
    .getByRole("menuitem", { name: "Delete" })
    .click();
  await page
    .getByRole("alertdialog", { name: "Delete chat?" })
    .getByRole("button", { name: "Delete" })
    .click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(
    page.getByRole("heading", { name: "What are you studying?" }),
  ).toBeVisible();
  await expect(
    (await openSidebar(page)).getByText("No chats yet."),
  ).toBeVisible();
});
