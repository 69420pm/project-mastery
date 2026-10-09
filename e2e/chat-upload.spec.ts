import path from "node:path";
import type { Page } from "@playwright/test";
import {
  adminClient,
  expect,
  openSidebar,
  storedFilePaths,
  test,
} from "./fixtures";

async function uploadFromNewChat(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach" }).click();
  await page.getByRole("menuitem", { name: "Upload file" }).click();
  await (await chooser).setFiles(PNG);
  await expect(
    page.getByRole("button", { name: "Remove whiteboard", exact: true }),
  ).toBeVisible();
}

const PNG = path.join(__dirname, "files", "whiteboard.png");

async function storedMaterialNames(courseId: string) {
  const { data, error } = await adminClient()
    .from("materials")
    .select("name")
    .eq("course_id", courseId);
  if (error) throw new Error(`Reading Materials failed: ${error.message}`);
  return data.map(({ name }) => name);
}

test("uploading a file from the message box, sending it and finding it in Materials", async ({
  page,
  student,
  course,
}) => {
  await page.goto(course.chatPath);

  await page.getByRole("button", { name: "Attach" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload file" }).click();
  await (await chooser).setFiles(PNG);

  // The chip shows the file name until the upload is registered, then the Material name.
  const remove = page.getByRole("button", {
    name: "Remove whiteboard",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeHidden();

  await page.getByRole("textbox", { name: "Message" }).fill("What is this?");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");

  const messages = page.getByTestId("message-text");
  await expect(messages.last()).toContainText(
    "Attached: whiteboard (image/png).",
  );
  await expect(
    messages.first().getByTestId("material-chip").filter({
      hasText: "whiteboard",
    }),
  ).toBeVisible();

  expect(await storedMaterialNames(course.id)).toEqual(["whiteboard"]);
  expect(await storedFilePaths(student.id, course.id)).toHaveLength(1);

  await page.goto(`/courses/${course.id}/materials`);
  await expect(
    page
      .getByRole("list", { name: "Materials" })
      .getByRole("button", { name: "whiteboard", exact: true }),
  ).toBeVisible();
});

test("a pasted file is uploaded like a picked one", async ({
  page,
  student,
  course,
}) => {
  await page.goto(course.chatPath);
  const textbox = page.getByRole("textbox", { name: "Message" });
  await textbox.click();

  await textbox.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  // The upload ends in a Material, which is not left as an unsent attachment
  // of the prompt input.
  await expect(
    page.getByRole("button", { name: "Remove pasted" }),
  ).toBeVisible();
  await expect.poll(() => storedMaterialNames(course.id)).toEqual(["pasted"]);
  expect(await storedFilePaths(student.id, course.id)).toHaveLength(1);
});

test("a file of another type is refused, and can be dismissed", async ({
  page,
  student,
  course,
}) => {
  await page.goto(course.chatPath);

  await page.locator('input[aria-label="Upload file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Limits"),
  });

  const chip = page.getByTestId("material-chip");
  await expect(chip.getByRole("alert")).toHaveText(
    "Upload a PDF or a PNG, JPEG or WebP image.",
  );
  // An unfinished upload keeps Send disabled.
  await page.getByRole("textbox", { name: "Message" }).fill("Hello");
  await expect(page.getByRole("button", { name: "Submit" })).toBeDisabled();

  await chip.getByRole("button", { name: "Remove notes" }).click();
  await expect(chip).toBeHidden();
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
  expect(await storedMaterialNames(course.id)).toEqual([]);
  expect(await storedFilePaths(student.id, course.id)).toEqual([]);
});

test("Back from a new Chat shows an upload that was not sent on the Materials page", async ({
  page,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await openSidebar(page);
  await page.getByRole("link", { name: "New chat" }).click();
  await expect(page).toHaveURL(course.chatPath);
  await uploadFromNewChat(page);

  await page.goBack();

  await expect(page).toHaveURL(`/courses/${course.id}/materials`);
  await expect(
    page
      .getByRole("list", { name: "Materials" })
      .getByRole("button", { name: "whiteboard", exact: true }),
  ).toBeVisible();
});

test("Back to a Chat shows its uploaded file as a file, not as deleted", async ({
  page,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await openSidebar(page);
  await page.getByRole("link", { name: "New chat" }).click();
  await uploadFromNewChat(page);
  await page.getByRole("textbox", { name: "Message" }).fill("What is this?");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(page.getByTestId("message-text").last()).toContainText(
    "Attached: whiteboard",
  );
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  // Leave the Chat by a link, so that Back returns through the router cache.
  await openSidebar(page);
  await page.getByRole("link", { name: "Materials" }).click();
  await expect(page).toHaveURL(`/courses/${course.id}/materials`);
  await page.goBack();

  await expect(
    page.getByTestId("message-text").first().getByTestId("material-chip"),
  ).toHaveText("whiteboard");
});
