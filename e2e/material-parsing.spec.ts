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

test("an uploaded PDF is parsed into chunks the Student can read", async ({
  page,
  course,
}) => {
  await page.goto(`/courses/${course.id}/materials`);
  // The "Upload files" button opens this hidden picker.
  await page.locator("input[type=file]").setInputFiles(PDF);

  const entry = page
    .getByRole("list", { name: "Materials" })
    .getByRole("listitem")
    .filter({ hasText: "two-page-lecture" });
  // The page refreshes itself while the parse runs (mock AI).
  await expect(entry.getByText("Parsed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await entry.getByRole("link", { name: "View chunks" }).click();

  await expect(
    page.getByRole("heading", { name: "two-page-lecture" }),
  ).toBeVisible();
  const chunks = page.getByRole("list", { name: "Chunks" });
  // The mock file call joins every unit into one chunk, over both pages.
  const chunk = chunks.getByRole("article", { name: "Content, Pages 1–2" });
  await expect(chunk).toBeVisible();
  // Both pages' mock formula $a^2 + b^2 = c^2$, rendered by KaTeX.
  await expect(chunk.locator(".katex")).toHaveCount(2);
});
