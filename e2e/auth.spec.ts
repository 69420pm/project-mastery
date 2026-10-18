import { expect, openSidebar, test } from "./fixtures";

test("a Student signs in, signs out and returns to the page they asked for", async ({
  page,
  context,
  student,
  course,
}) => {
  await context.clearCookies();
  const signInAs = async () => {
    await page.getByLabel("Email").fill(student.email);
    await page.getByLabel("Password").fill(student.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };

  await page.goto("/login");
  await signInAs();
  await expect(page).toHaveURL(/\/courses$/);

  await openSidebar(page, "Courses");
  const accountMenu = page.getByRole("button", { name: "Account menu" });
  await expect(accountMenu).toContainText(student.email);
  await accountMenu.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("status")).toHaveText("You are signed out.");

  const materialsPath = `/courses/${course.id}/materials`;
  await page.goto(materialsPath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await signInAs();
  await expect(page).toHaveURL(materialsPath);
});
