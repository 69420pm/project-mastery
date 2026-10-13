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

test("a parsed Material is built into a Knowledge map of big ideas and KCs", async ({
  page,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  await page.locator("input[type=file]").setInputFiles(PDF);
  await expect(page.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(`/courses/${course.id}/map`);
  await expect(page.getByRole("status", { name: "Build status" })).toHaveText(
    "Not built yet.",
  );
  await page.getByRole("button", { name: "Build knowledge map" }).click();

  // The page refreshes itself while the build runs (mock AI).
  await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible({
    timeout: 30_000,
  });
  const kcs = page.getByRole("list", { name: "Knowledge components" });
  // The mock names every KC with its text and teaches it on page 1.
  const kc = kcs.getByRole("article").first();
  await expect(kc.getByText("Fact")).toBeVisible();
  await expect(kc.getByText("Sources: two-page-lecture p. 1")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Build status" }),
  ).toContainText("Last built");
  // The mock links its one KC only to itself, so the check finds an orphan.
  await expect(
    page.getByRole("region", { name: "Check report" }),
  ).toContainText("KCs without links");
  // The mock parse labels no chunk an exercise.
  await expect(page.getByRole("region", { name: "Exercises" })).toContainText(
    "The materials have no exercises.",
  );
});
