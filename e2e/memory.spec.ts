import { expect, openBriefData, test } from "./fixtures";

test.describe("signed in", () => {
  test("writes Memory on the Brief page and keeps it after a reload", async ({
    page,
    course,
  }) => {
    await page.goto(`/courses/${course.id}/brief`);
    const panel = await openBriefData(page);
    await expect(panel.getByText("What the AI knows about you")).toBeVisible();

    const memory = panel.getByRole("textbox", { name: "Memory" });
    await expect(memory).toHaveAttribute(
      "placeholder",
      "Nothing yet. The AI adds notes as you study.",
    );
    await memory.fill("I prefer worked examples.");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByText("Saved.", { exact: true })).toBeVisible();

    await page.reload();
    const reopened = await openBriefData(page);
    await expect(reopened.getByRole("textbox", { name: "Memory" })).toHaveValue(
      "I prefer worked examples.",
    );
  });
});
