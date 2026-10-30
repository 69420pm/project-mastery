import path from "node:path";
import { expect, test } from "./fixtures";

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

test("a parsed Material is built into a Knowledge map", async ({
  page,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await page.locator("input[type=file]").setInputFiles(PDF);
  await expect(page.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(`/courses/${course.id}/map`);
  const status = page.getByRole("status", { name: "Build status" });
  await expect(status).toHaveText("Not built yet.");
  await page.getByRole("button", { name: "Build knowledge map" }).click();

  // The page refreshes itself while the build runs (mock AI).
  const update = page
    .locator("header")
    .getByRole("button", { name: "Update map" });
  await expect(update).toBeVisible({ timeout: 30_000 });
  await expect(status).toContainText("Last built");
  await expect(status).not.toContainText("Build failed");
  // The map holds the Material's KCs.
  await expect(page.getByText("No map yet")).toBeHidden();
});
