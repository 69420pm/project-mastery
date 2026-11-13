import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXAM_TITLE, smallCourseRows } from "./brief-course";
import { briefSetup, parseScenario, setupSchema } from "./brief-scenario";

const course = {
  courseId: "course",
  studentId: "student",
  examChapterIds: ["final", "resit"],
};
const now = new Date("2026-11-13T10:00:00Z");

describe("briefSetup", () => {
  it("without a setup stores a new Brief whose old exams are proposed, not asked", () => {
    const plan = briefSetup(course, setupSchema.parse({}), now);
    expect(plan.brief).toMatchObject({
      course_id: "course",
      owner: "student",
      exam_date: null,
      goal: null,
      scope_confirmed: false,
      reserved_exam_answered: false,
    });
    expect(plan.examChapters).toEqual({
      ids: ["final", "resit"],
      isExam: null,
      asked: false,
    });
  });

  it("stores an answered Brief with its old exams confirmed", () => {
    const plan = briefSetup(
      course,
      setupSchema.parse({
        answered: {
          examInDays: 60,
          goal: "pass",
          openBook: false,
          formulaSheet: true,
          calculator: false,
          notes: "New to proofs.",
        },
      }),
      now,
    );
    expect(plan.brief).toMatchObject({
      exam_date: "2027-01-12",
      goal: "pass",
      open_book: false,
      formula_sheet: true,
      calculator: false,
      scope_confirmed: true,
      notes: "New to proofs.",
      reserved_exam_answered: true,
      reserved_exam_chapter_id: null,
    });
    expect(plan.examChapters).toMatchObject({ isExam: true, asked: true });
  });
});

describe("smallCourseRows", () => {
  it("inserts parents first, with Klausur 2025 proposed and the admin text on Chapter 2", () => {
    let n = 0;
    const { inserts, course: seeded } = smallCourseRows(
      "student",
      "Vektoren und Matrizen",
      () => `id-${++n}`,
    );
    expect(inserts.map((i) => i.table)).toEqual([
      "courses",
      "materials",
      "chapters",
      "chunks",
      "topics",
      "kcs",
      "topic_kcs",
      "kc_sources",
    ]);
    const rows = (table: string) =>
      inserts.find((i) => i.table === table)!.rows;
    expect(rows("courses")).toEqual([
      { id: seeded.courseId, owner: "student", name: "Vektoren und Matrizen" },
    ]);
    expect(rows("materials").map((m) => m.name)).toEqual([
      "Lab manual",
      "Lecture notes",
    ]);
    expect(rows("chapters").filter((c) => c.exam_proposed)).toEqual([
      expect.objectContaining({ id: seeded.examChapterId, title: EXAM_TITLE }),
    ]);
    expect(rows("chunks")).toContainEqual(
      expect.objectContaining({
        label: "admin",
        markdown: "Chapter 2 is not examined.",
      }),
    );
    expect(rows("topic_kcs")).toContainEqual(
      expect.objectContaining({
        topic_id: seeded.chapter2Topic,
        kc_id: seeded.chapter2Kcs[0],
      }),
    );
    for (const { rows: tableRows } of inserts.slice(1, 6)) {
      for (const row of tableRows) {
        expect(row).toMatchObject({ course_id: seeded.courseId });
      }
    }
  });
});

describe("the scenario files", () => {
  const dir = "evals/brief/scenarios";

  it("each parse, with a persona, its talk, ground truth on both Courses and a checklist", async () => {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const text = await readFile(path.join(dir, file), "utf8");
      expect(() => parseScenario(text), file).not.toThrow();
      for (const heading of [
        "## Persona",
        "## How they talk",
        "## Ground truth",
        "### Course A",
        "### Course B",
        "## Checklist",
      ]) {
        expect(text, `${file}: ${heading}`).toContain(heading);
      }
    }
  });

  it("reads a setup block, and none as a new Brief", () => {
    expect(parseScenario("# x\n\n## Persona\n")).toEqual({});
    expect(
      parseScenario(
        '## Setup\n\n```json\n{ "answered": { "examInDays": 1, "goal": "pass", "openBook": true, "formulaSheet": false, "calculator": true } }\n```\n\n## Persona\n',
      ).answered?.goal,
    ).toBe("pass");
  });
});
