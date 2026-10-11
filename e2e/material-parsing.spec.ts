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
  const first = chunks.getByRole("article", { name: "Content, Page 1" });
  await expect(first).toBeVisible();
  await expect(
    chunks.getByRole("article", { name: "Content, Page 2" }),
  ).toBeVisible();
  // The mock's formula $a^2 + b^2 = c^2$, rendered by KaTeX.
  await expect(first.locator(".katex")).toBeVisible();
});
