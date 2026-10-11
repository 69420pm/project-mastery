import path from "node:path";
import type { Page } from "@playwright/test";
import {
  adminClient,
  allFilePaths,
  expect,
  seedMaterial,
  test,
} from "./fixtures";

const PDF = path.join(
  __dirname,
  "..",
  "src",
  "features",
  "ingestion",
  "workflows",
  "test-files",
  "two-page-lecture.pdf",
);

const materialEntry = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Materials" })
    .getByRole("listitem")
    .filter({ hasText: name });

/** Sets a seeded Material's parse state, as an earlier parse left it. */
async function setParseState(
  materialId: string,
  state: { parse_status: string; parse_failure?: string },
) {
  const { error } = await adminClient()
    .from("materials")
    .update(state)
    .eq("id", materialId);
  if (error)
    throw new Error(`Setting the parse state failed: ${error.message}`);
}

test("a Material uploaded before parsing existed is parsed with Parse", async ({
  page,
  student,
  course,
}) => {
  const { id } = await seedMaterial(student.id, course.id, {
    name: "Old lecture",
    file: PDF,
    mediaType: "application/pdf",
  });
  await setParseState(id, { parse_status: "not_parsed" });

  await page.goto(`/courses/${course.id}/materials`);
  const entry = materialEntry(page, "Old lecture");
  await expect(entry.getByText("Not parsed")).toBeVisible();
  await entry.getByRole("button", { name: "Parse" }).click();

  await expect(entry.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(entry.getByRole("button", { name: "Parse" })).toHaveCount(0);
});

test("a failed parse shows its reason, and Retry finishes it", async ({
  page,
  student,
  course,
}) => {
  const { id } = await seedMaterial(student.id, course.id, {
    name: "Broken lecture",
    file: PDF,
    mediaType: "application/pdf",
  });
  await setParseState(id, {
    parse_status: "failed",
    parse_failure: "The AI could not read page 2",
  });

  await page.goto(`/courses/${course.id}/materials`);
  const entry = materialEntry(page, "Broken lecture");
  await expect(
    entry.getByText("Failed: The AI could not read page 2"),
  ).toBeVisible();
  await entry.getByRole("button", { name: "Retry" }).click();

  await expect(entry.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("deleting a parsed Material removes its page images with its file", async ({
  page,
  student,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await page.locator("input[type=file]").setInputFiles(PDF);
  const entry = materialEntry(page, "two-page-lecture");
  await expect(entry.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(
    (await allFilePaths(`${student.id}/${course.id}`)).length,
  ).toBeGreaterThan(1);

  await entry.getByRole("button", { name: "Material actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete material?" });
  await confirm.getByRole("button", { name: "Delete" }).click();

  // The dialog closes once the Material is gone; while it is open, the page
  // behind it is hidden from the accessibility tree.
  await expect(confirm).toBeHidden();
  await expect(page.getByText("No materials yet")).toBeVisible();
  expect(await allFilePaths(`${student.id}/${course.id}`)).toEqual([]);
});
