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

  // The Today card names the next Topic and starts a new Chat.
  const today = page.getByRole("region", { name: "Today" });
  await expect(
    today.getByRole("link", { name: /^Mock text from the mock AI/ }),
  ).toHaveAttribute(
    "href",
    new RegExp(`^/courses/${course.id}/map/[0-9a-f-]{36}$`),
  );
  await expect(today.getByRole("link", { name: "Start" })).toHaveAttribute(
    "href",
    `/courses/${course.id}/chat`,
  );

  // Skipping the next Topic on its page takes it off the card. The mock
  // builds a single Topic, so nothing is left to plan.
  await today
    .getByRole("link", { name: /^Mock text from the mock AI/ })
    .click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unskip" })).toBeVisible();
  await expect(page.getByLabel("Plan")).toContainText("skipped");
  await page.goto(`/courses/${course.id}/map`);
  const todayAfterSkip = page.getByRole("region", { name: "Today" });
  await expect(todayAfterSkip).toContainText("Nothing planned for today.");
  await expect(
    todayAfterSkip.getByRole("link", { name: /^Mock text from the mock AI/ }),
  ).toHaveCount(0);

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

  // Opening a Topic shows its detail and its KC graph.
  await card.click();
  await expect(page).toHaveURL(
    new RegExp(`^.*/courses/${course.id}/map/[0-9a-f-]{36}$`),
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Mock text from the mock AI",
  );
  await expect(
    page.getByRole("region", { name: "Central question" }),
  ).toBeVisible();
  // The breadcrumb reads Course map › Topic name.
  const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(
    breadcrumb.getByRole("link", { name: "Course map" }),
  ).toBeVisible();
  await expect(breadcrumb).toContainText("Mock text from the mock AI");

  // The mock names every KC with its text and teaches it on pages 1–2.
  const kcGraph = page.getByRole("application", {
    name: "Knowledge map graph",
  });
  // Without Big-idea groups the KCs are laid out again, flat.
  await page.getByRole("button", { name: "Layers" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Big-idea groups" }).click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Big-idea groups" }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await kcGraph
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

  // Esc clears the selection.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});
