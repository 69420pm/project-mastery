import { randomUUID } from "node:crypto";
import type { AdminSupabase } from "@/lib/supabase/types";
import { insertRows } from "./gold-course";

/** The lecture notes' last Chapter, which the parse proposed as an old exam. */
export const EXAM_TITLE = "Klausur 2025";

/** The small Course's Materials and the Topic its admin text leaves out. */
export type SmallCourse = {
  courseId: string;
  labManualId: string;
  /** The old exam Chapter inside the lecture notes. */
  examChapterId: string;
  /** The KCs of Chapter 2, which an admin text says is not examined. */
  chapter2Kcs: string[];
  /** The Topic that holds them. */
  chapter2Topic: string;
};

/** Rows of one table, in insert order. */
export type Inserts = Array<{
  table: string;
  rows: Array<Record<string, unknown>>;
}>;

/**
 * The rows of a small Course of `studentId` named `name` (#229): a lab
 * manual and lecture notes whose admin chunk says "Chapter 2 is not
 * examined", with Chapters 1 and 2 and a last Chapter "Klausur 2025" that
 * the parse proposed as an old exam, and a map of two top-level Topics, one
 * per teaching Chapter. Parents come before children.
 */
export function smallCourseRows(
  studentId: string,
  name: string,
  newId: () => string = randomUUID,
): { inserts: Inserts; course: SmallCourse } {
  const courseId = newId();
  const owned = { owner: studentId, course_id: courseId };
  const [labManualId, notesId] = [newId(), newId()];
  const materials = [
    [labManualId, "Lab manual"],
    [notesId, "Lecture notes"],
  ].map(([id, materialName], index) => ({
    ...owned,
    id,
    name: materialName,
    media_type: "application/pdf",
    size_bytes: 1,
    storage_path: `${studentId}/${courseId}/${id}`,
    parse_status: "parsed",
    created_at: new Date(Date.UTC(2026, 9, 1 + index)).toISOString(),
  }));
  // The lab manual's root Chapter, and the lecture notes' root Chapter with
  // its three Chapters, each titled as printed.
  const [labRoot, notesRoot, chapter1, chapter2, examChapter] = [
    newId(),
    newId(),
    newId(),
    newId(),
    newId(),
  ];
  const chapter = (
    id: string,
    materialId: string,
    parentId: string | null,
    position: number,
    title: string,
  ) => ({
    ...owned,
    id,
    material_id: materialId,
    parent_id: parentId,
    position,
    depth: parentId === null ? 0 : 1,
    title,
    page_from: Math.max(position, 1),
    exam_proposed: title === EXAM_TITLE,
  });
  const chapters = [
    chapter(labRoot, labManualId, null, 0, "Lab manual"),
    chapter(notesRoot, notesId, null, 0, "Lecture notes"),
    chapter(chapter1, notesId, notesRoot, 1, "Chapter 1: Vectors"),
    chapter(chapter2, notesId, notesRoot, 2, "Chapter 2: Matrices"),
    chapter(examChapter, notesId, notesRoot, 3, EXAM_TITLE),
  ];
  const chunk = (
    page: number,
    chapterId: string,
    label: string,
    markdown: string,
  ) => ({
    ...owned,
    id: newId(),
    material_id: notesId,
    chapter_id: chapterId,
    position: page - 1,
    page_from: page,
    page_to: page,
    label,
    markdown,
  });
  const chunks = [
    chunk(1, notesRoot, "admin", "Chapter 2 is not examined."),
    chunk(2, chapter1, "content", "# Chapter 1: Vectors\nA vector is ..."),
    chunk(3, chapter2, "content", "# Chapter 2: Matrices\nA matrix is ..."),
    chunk(
      4,
      examChapter,
      "exercise",
      `# ${EXAM_TITLE}\n**Problem 1.** Add the vectors (1, 2) and (3, 4).`,
    ),
  ];

  // Two top-level Topics, each holding one Chapter's KC.
  const [vectors, matrices] = [newId(), newId()];
  const topic = (
    id: string,
    topicName: string,
    chapterId: string,
    position: number,
  ) => ({
    ...owned,
    id,
    name: topicName,
    central_question: `What is ${topicName}?`,
    chapter_ids: [chapterId],
    position,
  });
  const kc = (kcName: string, position: number) => ({
    ...owned,
    id: newId(),
    name: kcName,
    description: `${kcName}.`,
    origin: "content",
    position,
  });
  const kcs = [kc("Vector addition", 0), kc("Matrix product", 1)];
  return {
    inserts: [
      { table: "courses", rows: [{ id: courseId, owner: studentId, name }] },
      { table: "materials", rows: materials },
      { table: "chapters", rows: chapters },
      { table: "chunks", rows: chunks },
      {
        table: "topics",
        rows: [
          topic(vectors, "Chapter 1: Vectors", chapter1, 0),
          topic(matrices, "Chapter 2: Matrices", chapter2, 1),
        ],
      },
      { table: "kcs", rows: kcs },
      {
        table: "topic_kcs",
        rows: [vectors, matrices].map((topicId, index) => ({
          topic_id: topicId,
          kc_id: kcs[index]!.id,
          owner: studentId,
          position: 0,
        })),
      },
      {
        table: "kc_sources",
        rows: kcs.map((row, index) => ({
          ...owned,
          kc_id: row.id,
          chunk_id: chunks[index + 1]!.id,
        })),
      },
    ],
    course: {
      courseId,
      labManualId,
      examChapterId: examChapter,
      chapter2Kcs: [kcs[1]!.id],
      chapter2Topic: matrices,
    },
  };
}

/** Seeds the small Course (`smallCourseRows`) for `studentId`. */
export async function seedSmallCourse(
  supabase: AdminSupabase,
  studentId: string,
  name: string,
): Promise<SmallCourse> {
  const { inserts, course } = smallCourseRows(studentId, name);
  for (const { table, rows } of inserts) {
    await insertRows(supabase, table, rows);
  }
  return course;
}
