import path from "node:path";
import { expect, seedMaterial, test } from "./fixtures";

const PDF = path.join(__dirname, "files", "lecture-notes.pdf");

test("attaching a Material to a message, then deleting it", async ({
  page,
  student,
  course,
}) => {
  await seedMaterial(student.id, course.id, {
    name: "Lecture 3",
    file: PDF,
    mediaType: "application/pdf",
  });
  await page.goto(course.chatPath);

  // Pick the Material in the message box.
  await page.getByRole("button", { name: "Attach" }).click();
  await page.getByRole("menuitem", { name: "Choose from materials" }).click();
  const picker = page.getByRole("dialog", { name: "Choose from materials" });
  await picker
    .getByRole("combobox", { name: "Search materials" })
    .fill("Lecture");
  await picker.getByRole("option", { name: /Lecture 3/ }).click();
  await picker.getByRole("button", { name: "Close" }).click();
  await expect(picker).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Remove Lecture 3" }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Message" }).fill("Explain this");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");

  // The mock AI names the files it received.
  const messages = page.getByTestId("message-text");
  await expect(messages.last()).toContainText(
    "Attached: Lecture 3 (application/pdf).",
  );
  const sentChip = messages
    .first()
    .getByTestId("material-chip")
    .filter({ hasText: "Lecture 3" });
  await expect(sentChip).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Lecture 3" }),
  ).toBeHidden();

  // The chip opens the viewer.
  await sentChip.getByRole("button", { name: "Lecture 3" }).click();
  const viewer = page.getByRole("dialog", { name: "Lecture 3" });
  await expect(viewer.getByText("Limits and continuity")).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();

  // Deleting the Material says where it is attached.
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const chatUrl = page.url();
  await page.goto(`/courses/${course.id}/materials`);
  await page
    .getByRole("list", { name: "Materials" })
    .getByRole("listitem")
    .filter({ hasText: "Lecture 3" })
    .getByRole("button", { name: "Material actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete material?" });
  await expect(confirm).toContainText("It is attached in 1 chat.");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).toBeHidden();

  // The Chat shows it as deleted.
  await page.goto(chatUrl);
  await expect(
    page.getByTestId("message-text").first().getByTestId("material-chip"),
  ).toHaveText("Deleted file: Lecture 3");
});
