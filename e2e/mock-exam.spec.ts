import { randomUUID } from "node:crypto";
import { adminClient, expect, seedKc, test } from "./fixtures";

/**
 * A mock exam from the Today card: a ready mock (assembly runs in a
 * workflow, covered by its own tests) is started on its page, one task is
 * answered and the mock is submitted.
 */

test("Mock exam: start, answer one task, submit", async ({
  page,
  student,
  course,
}) => {
  await seedKc(student.id, course.id);
  const admin = adminClient();
  const mockId = randomUUID();
  const mock = await admin.from("mock_exams").insert({
    id: mockId,
    owner: student.id,
    course_id: course.id,
    status: "ready",
    duration_minutes: 18,
    predicted_score: 9,
  });
  if (mock.error) throw new Error(mock.error.message);
  const item = await admin.from("mock_items").insert({
    mock_id: mockId,
    owner: student.id,
    position: 0,
    exercise_id: null,
    prompt: "Name the stages of a turbojet.",
    points: 6,
    predicted_success: 0.5,
  });
  if (item.error) throw new Error(item.error.message);

  await page.goto(`/courses/${course.id}/map`);
  await page
    .getByRole("region", { name: "Today" })
    .getByRole("link", { name: "Continue mock exam" })
    .click();
  await page.getByRole("button", { name: "Start" }).click();

  const card = page.getByTestId("task-card");
  await expect(card.getByText("Name the stages of a turbojet.")).toBeVisible();
  await card.getByRole("textbox", { name: "Your answer" }).fill("Compressor");
  await card.getByRole("textbox", { name: "Your answer" }).blur();
  await expect(card.getByText("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Submit" })
    .click();
  await expect(page.getByText("Submitted. Grading comes next.")).toBeVisible();

  const { data } = await admin
    .from("mock_exams")
    .select("status")
    .eq("id", mockId)
    .single();
  expect(data?.status).toBe("submitted");
});
