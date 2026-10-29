import { adminClient, expect, openBriefData, test } from "./fixtures";

// The mock AI (AI_PROVIDER=mock) quotes the message and ends with this.
const REPLY_END = "it never calls a real model.";
// It streams a word every 75 ms, so a reply takes several seconds under load.
const REPLY_DONE = { timeout: 15_000 };

test.describe("signed in", () => {
  test("opens the Brief with its opening question and keeps the conversation", async ({
    page,
    course,
  }) => {
    await page.goto(`/courses/${course.id}/materials`);
    await page
      .getByRole("link", { name: "Tell the AI about your exam" })
      .click();
    await expect(page).toHaveURL(`/courses/${course.id}/brief`);

    const log = page.getByRole("log");
    await expect(log.getByText("When is it?")).toBeVisible();

    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill("The exam is on 3 December.");
    await input.press("Enter");
    await expect(log.getByText(REPLY_END)).toBeVisible(REPLY_DONE);

    // The reply is stored just as its stream ends.
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("brief_messages")
          .select("id")
          .eq("course_id", course.id)
          .eq("role", "assistant");
        return data?.length;
      })
      .toBe(2);

    await page.reload();
    await expect(log.getByText("When is it?")).toBeVisible();
    await expect(
      log.getByText("The exam is on 3 December.", { exact: true }),
    ).toBeVisible();
    await expect(log.getByText(REPLY_END)).toBeVisible(REPLY_DONE);
  });

  test("asks whether a Material parsed after intake is an old exam", async ({
    page,
    student,
    course,
  }) => {
    const admin = adminClient();
    const materialId = crypto.randomUUID();
    const material = await admin.from("materials").insert({
      id: materialId,
      course_id: course.id,
      owner: student.id,
      name: "Klausur 2024",
      media_type: "application/pdf",
      size_bytes: 1,
      storage_path: `${student.id}/${course.id}/${materialId}`,
      parse_status: "parsed",
    });
    expect(material.error).toBeNull();
    const brief = await admin.from("briefs").insert({
      course_id: course.id,
      owner: student.id,
      exam_date: "2026-12-03",
      goal: "pass",
      hours_per_week: 5,
      question_style: "written",
      open_book: false,
      formula_sheet: false,
      calculator: true,
      scope_confirmed: true,
    });
    expect(brief.error).toBeNull();

    await page.goto(`/courses/${course.id}/brief`);
    const log = page.getByRole("log");
    await expect(
      log.getByText("Are any of these old exams? Klausur 2024"),
    ).toBeVisible();
    await expect(
      log.getByText("Klausur 2024 looks like an old exam by its name."),
    ).toBeVisible();

    // Asked once: a reload shows the same single question.
    await page.reload();
    await expect(log.getByText(/Are any of these old exams/)).toHaveCount(1);

    const panel = await openBriefData(page);
    await expect(
      panel.getByRole("region", { name: "Old exams" }).getByText("None"),
    ).toBeVisible();
  });
});
