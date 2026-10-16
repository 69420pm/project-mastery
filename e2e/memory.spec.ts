import { expect, test } from "./fixtures";

test.describe("signed in", () => {
  test("writes Memory on the Brief page and keeps it after a reload", async ({
    page,
    course,
  }) => {
    await page.goto(`/courses/${course.id}/brief`);
    await expect(page.getByText("What the AI knows about you")).toBeVisible();

    const memory = page.getByRole("textbox", { name: "Memory" });
    await expect(memory).toHaveAttribute(
      "placeholder",
      "Nothing yet. The AI adds notes as you study.",
    );
    await memory.fill("I prefer worked examples.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Memory" })).toHaveValue(
      "I prefer worked examples.",
    );
  });
});
