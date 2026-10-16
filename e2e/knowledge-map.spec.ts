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
  await expect(page.getByRole("button", { name: "Update map" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("status", { name: "Build status" }),
  ).toContainText("Last built");
  // The mock links its one KC only to itself, so the check finds an orphan.
  await expect(
    page.getByRole("region", { name: "Check report" }),
  ).toContainText("KCs without links");

  // The mock names every KC with its text and teaches it on pages 1–2.
  const graph = page.getByRole("application", { name: "Knowledge map graph" });
  await graph
    .getByRole("button", { name: /^Mock text from the mock AI/ })
    .first()
    .click();
  // Beside the graph, or in a Sheet on a phone.
  const panel = page.getByLabel("KC details", { exact: true });
  const overview = panel.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("Mock text from the mock AI");
  await expect(overview).toContainText("Fact");
  await expect(panel.getByRole("region", { name: "Learning" })).toContainText(
    "No attempts yet.",
  );
  await expect(panel.getByRole("region", { name: "Sources" })).toContainText(
    "two-page-lecture pp. 1–2",
  );
  // The mock parse labels no chunk an exercise.
  await expect(panel.getByRole("region", { name: "Exercises" })).toContainText(
    "No Exercise tests it.",
  );
  // The built map starts the priorities; a KC no exam, Exercise or KC
  // needs ranks low. The panel stays open while the page polls.
  await expect(
    panel.getByRole("region", { name: "Priority" }).getByText("Low priority"),
  ).toBeVisible({ timeout: 30_000 });
});
