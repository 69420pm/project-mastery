import { describe, expect, test } from "vitest";
import {
  briefChapters,
  confirmedExams,
  unaskedExams,
  type StoredChapter,
} from "./old-exams";

const chapter = (
  id: string,
  parentId: string | null,
  depth: number,
  fields: Partial<StoredChapter> = {},
): StoredChapter => ({
  id,
  parentId,
  title: id,
  depth,
  examProposed: false,
  exam: null,
  examAsked: false,
  ...fields,
});

// Script › 4 › 4.1 › Lemma, and Script › Klausur 2023 › Aufgabe 1.
const script = [
  chapter("Script", null, 0),
  chapter("4", "Script", 1),
  chapter("4.1", "4", 2),
  chapter("Lemma", "4.1", 3),
  chapter("Klausur 2023", "Script", 1, { examProposed: true }),
  chapter("Aufgabe 1", "Klausur 2023", 2),
];

describe("briefChapters", () => {
  test("lists Chapters to depth 2 and a deeper one only when it is about an exam", () => {
    const deepExam = [
      ...script,
      chapter("Probe", "4.1", 3, { examProposed: true }),
    ];
    expect(briefChapters(deepExam).map(({ id }) => id)).toEqual([
      "Script",
      "4",
      "4.1",
      "Klausur 2023",
      "Aufgabe 1",
      "Probe",
    ]);
  });
});

describe("confirmedExams", () => {
  test("names each confirmed Chapter not inside another by Material and Chapter", () => {
    const confirmed = script.map((c) =>
      c.id === "Klausur 2023" || c.id === "Aufgabe 1"
        ? { ...c, exam: true }
        : c,
    );
    expect(
      confirmedExams([
        { name: "Script", chapters: confirmed },
        {
          name: "Altklausur",
          chapters: [chapter("root", null, 0, { exam: true })],
        },
      ]),
    ).toEqual([
      { id: "Klausur 2023", name: "Script › Klausur 2023" },
      { id: "root", name: "Altklausur" },
    ]);
  });
});

describe("unaskedExams", () => {
  test("asks about proposed Chapters, and a root whose Material's name looks like an exam, once", () => {
    const materials = [
      { name: "Script", parsed: true, chapters: script },
      {
        name: "Resit exam",
        parsed: true,
        chapters: [chapter("Resit exam", null, 0)],
      },
      {
        name: "Klausur 2024",
        parsed: false,
        chapters: [chapter("Klausur 2024", null, 0)],
      },
    ];
    expect(unaskedExams(materials)).toEqual([
      { id: "Klausur 2023", name: "Script › Klausur 2023" },
      { id: "Resit exam", name: "Resit exam" },
    ]);

    script[4] = { ...script[4]!, examAsked: true };
    expect(unaskedExams(materials).map(({ id }) => id)).toEqual(["Resit exam"]);
  });
});
