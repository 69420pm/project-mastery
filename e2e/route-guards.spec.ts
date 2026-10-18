import { randomUUID } from "node:crypto";
import { adminClient, expect, seedCourse, test } from "./fixtures";

/** The pages inside a Course, apart from the Chat (see chat.spec.ts). */
const coursePages = [
  ["Brief", (courseId: string) => `/courses/${courseId}/brief`],
  ["Map", (courseId: string) => `/courses/${courseId}/map`],
  ["Materials", (courseId: string) => `/courses/${courseId}/materials`],
  [
    "a Material's chunks",
    (courseId: string) => `/courses/${courseId}/materials/${randomUUID()}`,
  ],
] as const;

test.describe("signed out", () => {
  for (const [name, path] of [
    ["the Course list", () => "/courses"],
    ...coursePages,
  ] as const) {
    test(`${name} redirects to sign-in with its path as next`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      const target = path(randomUUID());

      await page.goto(target);

      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(target)}`);
    });
  }
});

test("an invalid email link shows the link error page", async ({ page }) => {
  await page.goto(`/auth/confirm?token_hash=${randomUUID()}&type=email`);

  await expect(page).toHaveURL("/auth/error");
  await expect(
    page.getByRole("heading", { name: "This link did not work" }),
  ).toBeVisible();
});

test("an unknown Course, an unknown Material and another Student's Course are not found", async ({
  page,
  course,
}) => {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: `other-${randomUUID()}@example.com`,
    email_confirm: true,
  });
  if (error)
    throw new Error(`Creating another Student failed: ${error.message}`);
  try {
    const theirs = await seedCourse(data.user.id, "Their Course");
    const paths = [
      ...coursePages.map(([, path]) => path(randomUUID())),
      ...coursePages.map(([, path]) => path(theirs.id)),
      `/courses/${course.id}/materials/${randomUUID()}`,
    ];

    for (const path of paths) {
      const response = await page.goto(path);

      expect(response?.status(), path).toBe(404);
      await expect(
        page.getByText("This page could not be found."),
      ).toBeVisible();
    }
  } finally {
    await admin.auth.admin.deleteUser(data.user.id);
  }
});
