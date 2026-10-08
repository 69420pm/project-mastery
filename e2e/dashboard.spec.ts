import { expect, test } from "./fixtures";

test("a signed-in Student sees the dashboard", async ({ page, student }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome" }),
  ).toBeVisible();
  await expect(page.getByText(`Signed in as ${student.email}`)).toBeVisible();
});
