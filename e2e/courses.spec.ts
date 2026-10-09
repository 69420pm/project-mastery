import type { Page } from "@playwright/test";
import { adminClient, expect, test } from "./fixtures";

/** The names of a Student's stored Courses, as the database holds them. */
async function storedCourseNames(owner: string) {
  const { data, error } = await adminClient()
    .from("courses")
    .select("name")
    .eq("owner", owner);
  if (error) throw new Error(`Reading Courses failed: ${error.message}`);
  return data.map((course) => course.name);
}

function courseList(page: Page) {
  return page.getByRole("list", { name: "Courses" });
}

/** Opens the "…" menu of the listed Course named `name`. */
async function openCourseMenu(page: Page, name: string) {
  await courseList(page)
    .getByRole("listitem")
    .filter({ hasText: name })
    .getByRole("button", { name: "Course actions" })
    .click();
  return page.getByRole("menu");
}

test("signing in lands a new Student on their empty Course list", async ({
  page,
  student,
}) => {
  test.info().annotations.push({ type: "student", description: student.email });
  // Signed in without a `next` path, as after the sign-in form.
  await page.goto("/login");

  await expect(page).toHaveURL(/\/courses$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Courses" }),
  ).toBeVisible();
  await expect(page.getByText("Create your first course")).toBeVisible();
});

test("a Student creates, renames and deletes a Course", async ({
  page,
  student,
}) => {
  await page.goto("/courses");

  await page.getByRole("button", { name: "New course" }).first().click();
  const create = page.getByRole("dialog", { name: "New course" });
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create.getByText("Enter a name.")).toBeVisible();
  await create.getByRole("textbox", { name: "Name" }).fill("  Lin Alg ");
  await create.getByRole("button", { name: "Create" }).click();

  await expect(create).toBeHidden();
  await expect(courseList(page).getByRole("listitem")).toHaveText(["Lin Alg"]);
  await expect.poll(() => storedCourseNames(student.id)).toEqual(["Lin Alg"]);

  const menu = await openCourseMenu(page, "Lin Alg");
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename course" });
  await expect(rename.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Lin Alg",
  );
  await rename.getByRole("textbox", { name: "Name" }).fill("Linear Algebra");
  await rename.getByRole("button", { name: "Save" }).click();

  await expect(rename).toBeHidden();
  await expect(courseList(page).getByRole("listitem")).toHaveText([
    "Linear Algebra",
  ]);
  await expect
    .poll(() => storedCourseNames(student.id))
    .toEqual(["Linear Algebra"]);

  await (
    await openCourseMenu(page, "Linear Algebra")
  )
    .getByRole("menuitem", { name: "Delete" })
    .click();
  const confirm = page.getByRole("alertdialog", { name: "Delete course?" });
  await expect(confirm).toContainText("Linear Algebra");
  await expect(confirm).toContainText("deleted for good");
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(confirm).toBeHidden();
  await expect(page.getByText("Create your first course")).toBeVisible();
  await expect.poll(() => storedCourseNames(student.id)).toEqual([]);
});

test("the Course list shows the most recently updated Course first", async ({
  page,
  student,
}) => {
  const { error } = await adminClient()
    .from("courses")
    .insert([
      { owner: student.id, name: "Older", updated_at: "2026-01-01T00:00:00Z" },
      { owner: student.id, name: "Newer", updated_at: "2026-02-01T00:00:00Z" },
    ]);
  if (error) throw new Error(`Seeding Courses failed: ${error.message}`);

  await page.goto("/courses");

  await expect(courseList(page).getByRole("listitem")).toHaveText([
    "Newer",
    "Older",
  ]);
});
