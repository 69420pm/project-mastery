import { test as signedOut } from "@playwright/test";
import { expect, test } from "./fixtures";

signedOut("the root sends a visitor to sign in", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(/Project Mastery/);
  await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
});

test("the root sends a signed-in Student to their Course list", async ({
  page,
  student,
}) => {
  test.info().annotations.push({ type: "student", description: student.email });
  await page.goto("/");

  await expect(page).toHaveURL(/\/courses$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Courses" }),
  ).toBeVisible();
});
