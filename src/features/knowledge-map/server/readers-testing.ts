import "server-only";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/** The seeded Course the Knowledge map's server reads are tested on. */

export const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
export const OTHER_COURSE = "aaaaaaaa-c000-4000-8000-000000000002";
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const [LECTURE, NOTES] = [id(1), id(2)];
// c1–c3 are Lecture 1's pages 1, 2–3 and 4; d1 is page 1 of the later Notes.
export const [C1, C2, C3, D1] = [id(11), id(12), id(13), id(14)];
export const [BIG_IDEA, K1, K2, K3, EXERCISE] = [
  id(21),
  id(22),
  id(23),
  id(24),
  id(25),
];
export const RETIRED_KC = id(26);
export const [T1, T2] = [id(41), id(42)];
const topicText = (name: string) => ({
  course_id: COURSE,
  name,
  central_question: `${name}?`,
});

export function createDb() {
  const material = (materialId: string, name: string, position: number) => ({
    id: materialId,
    course_id: COURSE,
    name,
    media_type: "application/pdf",
    size_bytes: 1,
    position,
    parse_status: "parsed",
    is_exam: false,
  });
  const chunk = (
    chunkId: string,
    materialId: string,
    position: number,
    pages: [number, number],
  ) => ({
    id: chunkId,
    material_id: materialId,
    position,
    page_from: pages[0],
    page_to: pages[1],
    markdown: `Text of ${chunkId}`,
  });
  const ofCourse = (rows: FakeRow[]) =>
    rows.map((row) => ({ course_id: COURSE, ...row }));
  return fakeSupabase({
    tables: {
      materials: [
        material(NOTES, "Notes", 1),
        material(LECTURE, "Lecture 1", 0),
      ],
      material_pages: [],
      // Stored against reading order, which the readers restore.
      chunks: [
        chunk(D1, NOTES, 0, [1, 1]),
        chunk(C3, LECTURE, 2, [4, 4]),
        chunk(C2, LECTURE, 1, [2, 3]),
        chunk(C1, LECTURE, 0, [1, 1]),
      ],
      knowledge_map_builds: ofCourse([
        {
          status: "built",
          failure_reason: null,
          finished_at: "2026-01-02",
          check_report: {
            kcsPerPart: [{ part: "Thrust", kcs: 2, budget: 3 }],
            partsWithoutKcs: [],
            exercisesWithoutKcs: [],
            duplicates: [],
          },
        },
      ]),
      big_ideas: ofCourse([
        { id: BIG_IDEA, name: "Thrust", description: "Force.", position: 0 },
      ]),
      kcs: ofCourse([
        {
          id: K3,
          big_idea_id: BIG_IDEA,
          name: "Newton",
          description: "F = ma.",
          type: "fact",
          origin: "exercise",
          position: 2,
        },
        {
          id: K2,
          big_idea_id: BIG_IDEA,
          name: "Thrust equation",
          description: "F = m(v2 - v1).",
          type: "procedure",
          origin: "content",
          position: 1,
        },
        {
          id: K1,
          big_idea_id: BIG_IDEA,
          name: "Momentum",
          description: "m v.",
          type: "concept",
          origin: "content",
          position: 0,
        },
        // Retired, without sources or a Big idea: no reader shows it.
        {
          id: RETIRED_KC,
          big_idea_id: null,
          name: "Retired",
          description: "Gone with its Material.",
          type: "fact",
          origin: "content",
          position: 3,
          retired_at: "2026-01-03",
        },
      ]),
      kc_sources: ofCourse([
        { kc_id: K2, chunk_id: C2 },
        { kc_id: K1, chunk_id: C1 },
        { kc_id: K1, chunk_id: C2 },
      ]),
      prerequisite_links: ofCourse([
        { id: 1, from_kc: K1, to_kc: K2 },
        { id: 2, from_kc: K1, to_kc: RETIRED_KC },
      ]),
      exercises: ofCourse([
        {
          id: EXERCISE,
          question_chunk_id: C3,
          solution_chunk_id: null,
          difficulty: 2,
          position: 0,
        },
      ]),
      exercise_kcs: ofCourse([
        { exercise_id: EXERCISE, kc_id: K2 },
        { exercise_id: EXERCISE, kc_id: K1 },
        { exercise_id: EXERCISE, kc_id: RETIRED_KC },
      ]),
      topics: [
        { id: T2, big_idea_id: BIG_IDEA, position: 1, ...topicText("Two") },
        { id: T1, big_idea_id: BIG_IDEA, position: 0, ...topicText("One") },
        {
          id: id(43),
          big_idea_id: BIG_IDEA,
          position: 0,
          ...topicText("Other"),
          course_id: OTHER_COURSE,
        },
      ],
      topic_kcs: [
        { topic_id: T2, kc_id: K2, position: 0 },
        { topic_id: T1, kc_id: K1, position: 0 },
      ],
    },
    foreignKeys: {
      topic_kcs: { topic_id: "topics" },
    },
  });
}
