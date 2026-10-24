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

test("a parsed Material is built into a Course map of Topics", async ({
  page,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await page.locator("input[type=file]").setInputFiles(PDF);
  await expect(page.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Opening the Course lands on its Course map.
  await page.goto("/courses");
  await page
    .getByRole("list", { name: "Courses" })
    .getByRole("link", { name: course.name })
    .click();
  await expect(page).toHaveURL(`/courses/${course.id}/map`);
  await expect(page.getByRole("status", { name: "Build status" })).toHaveText(
    "Not built yet.",
  );
  await page.getByRole("button", { name: "Build knowledge map" }).click();

  // The page refreshes itself while the build runs (mock AI).
  await expect(page.getByRole("button", { name: "Update map" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("status", { name: "Build status" }),
  ).toContainText("Last built");

  // The mock names every Topic with its text.
  const graph = page.getByRole("application", { name: "Course map graph" });
  const card = graph
    .getByRole("link", { name: /^Mock text from the mock AI/ })
    .first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute(
    "href",
    new RegExp(`^/courses/${course.id}/map/[0-9a-f-]{36}$`),
  );
});
