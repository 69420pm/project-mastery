import { adminClient, expect, test } from "./fixtures";

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

  test("asks an open Finding once intake is done and stores the answer", async ({
    page,
    student,
    course,
  }) => {
    const admin = adminClient();
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
    const finding = await admin.from("findings").insert({
      course_id: course.id,
      owner: student.id,
      kind: "solution_mismatch",
      position: 0,
      text: "Exercise 3 prints 48.2%, but the worked steps give 50.8%.",
    });
    expect(finding.error).toBeNull();

    await page.goto(`/courses/${course.id}/brief`);
    const log = page.getByRole("log");
    await expect(
      log.getByText("but the worked steps give 50.8%. Which is right?"),
    ).toBeVisible();

    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill("The printed answer is wrong, 50.8% is right");
    await input.press("Enter");
    await expect(log.getByText(REPLY_END)).toBeVisible(REPLY_DONE);

    await page.reload();
    const findings = page.getByRole("region", { name: "Findings" });
    await expect(findings.getByText("Answered", { exact: true })).toBeVisible();
    await expect(
      findings.getByText("The printed answer is wrong, 50.8% is right"),
    ).toBeVisible();

    // Findings no longer show on the map.
    await page.goto(`/courses/${course.id}/map`);
    await expect(
      page.getByRole("heading", { name: "Knowledge map" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Findings" })).toHaveCount(0);
  });
});
