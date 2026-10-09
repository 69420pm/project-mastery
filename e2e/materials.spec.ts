import path from "node:path";
import type { Page } from "@playwright/test";
import { adminClient, expect, storedFilePaths, test } from "./fixtures";

const PDF = path.join(__dirname, "files", "lecture-notes.pdf");
const PNG = path.join(__dirname, "files", "whiteboard.png");

/** The stored Materials of a Course, oldest first. */
async function storedMaterials(courseId: string) {
  const { data, error } = await adminClient()
    .from("materials")
    .select("name, media_type, size_bytes, storage_path")
    .eq("course_id", courseId)
    .order("created_at");
  if (error) throw new Error(`Reading Materials failed: ${error.message}`);
  return data;
}

function materialsList(page: Page) {
  return page.getByRole("list", { name: "Materials" });
}

function materialEntry(page: Page, name: string) {
  return materialsList(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function upload(page: Page, files: string[]) {
  // The "Upload files" button opens this hidden picker.
  await page.locator("input[type=file]").setInputFiles(files);
}

test("uploading, renaming, opening and deleting Materials", async ({
  page,
  student,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await expect(page.getByText("No materials yet")).toBeVisible();

  await upload(page, [PDF, PNG]);

  await expect(materialEntry(page, "lecture-notes")).toContainText("PDF");
  await expect(materialEntry(page, "whiteboard")).toContainText("PNG");
  await expect(page.getByRole("list", { name: "Uploads" })).toBeHidden();
  await expect
    .poll(() => storedMaterials(course.id))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "lecture-notes",
          media_type: "application/pdf",
        }),
        expect.objectContaining({
          name: "whiteboard",
          media_type: "image/png",
        }),
      ]),
    );
  const stored = await storedMaterials(course.id);
  expect((await storedFilePaths(student.id, course.id)).sort()).toEqual(
    stored.map((material) => material.storage_path).sort(),
  );

  // Rename the PDF.
  await materialEntry(page, "lecture-notes")
    .getByRole("button", { name: "Material actions" })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename material" });
  await rename.getByRole("textbox", { name: "Name" }).fill("Lecture 1");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(rename).toBeHidden();
  await expect(materialEntry(page, "Lecture 1")).toBeVisible();

  // Open both in the viewer.
  await materialsList(page).getByRole("button", { name: "Lecture 1" }).click();
  const pdfViewer = page.getByRole("dialog", { name: "Lecture 1" });
  await expect(pdfViewer.getByText("Limits and continuity")).toBeVisible();
  await expect(pdfViewer.getByText("Page 1 of 1")).toBeVisible();
  await pdfViewer.getByRole("button", { name: "Close" }).click();

  await materialsList(page).getByRole("button", { name: "whiteboard" }).click();
  const imageViewer = page.getByRole("dialog", { name: "whiteboard" });
  const image = imageViewer.getByRole("img", { name: "whiteboard" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(32);
  await imageViewer.getByRole("button", { name: "Close" }).click();

  // Delete the image.
  await materialEntry(page, "whiteboard")
    .getByRole("button", { name: "Material actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete material?" });
  await expect(confirm).toContainText("“whiteboard” will be deleted for good.");
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(confirm).toBeHidden();
  await expect(materialEntry(page, "whiteboard")).toBeHidden();
  await expect(materialEntry(page, "Lecture 1")).toBeVisible();
  await expect
    .poll(() => storedMaterials(course.id))
    .toEqual([expect.objectContaining({ name: "Lecture 1" })]);
  const [kept] = await storedMaterials(course.id);
  expect(await storedFilePaths(student.id, course.id)).toEqual([
    kept?.storage_path,
  ]);
});

test("a file of another type is refused before uploading", async ({
  page,
  student,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);

  await page.locator("input[type=file]").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Limits"),
  });

  const uploads = page.getByRole("list", { name: "Uploads" });
  await expect(uploads.getByRole("alert")).toHaveText(
    "Upload a PDF or a PNG, JPEG or WebP image.",
  );
  await uploads.getByRole("button", { name: "Dismiss" }).click();
  await expect(uploads).toBeHidden();
  expect(await storedFilePaths(student.id, course.id)).toEqual([]);
});

test("the sidebar leads to the Materials page", async ({ page, course }) => {
  await page.goto(course.chatPath);

  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
  if (test.info().project.name === "mobile") await toggle.click();
  await page.getByRole("link", { name: "Materials" }).click();

  await expect(page).toHaveURL(`/courses/${course.id}/materials`);
  await expect(
    page.getByRole("heading", { name: "Materials", level: 1 }),
  ).toBeVisible();
});

test("deleting a Course says how many Materials go with it, and removes their files", async ({
  page,
  student,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await upload(page, [PDF]);
  await expect(materialEntry(page, "lecture-notes")).toBeVisible();

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
    "“Calculus” and its 1 material will be deleted for good.",
  );
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(confirm).toBeHidden();
  await expect(page.getByText("Create your first course")).toBeVisible();
  expect(await storedFilePaths(student.id, course.id)).toEqual([]);
  expect(await storedMaterials(course.id)).toEqual([]);
});
