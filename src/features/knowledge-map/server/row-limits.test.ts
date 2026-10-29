// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * The Knowledge map's readers on a Course larger than PostgREST's row
 * limit: every table has more than 1,000 rows, and an `in` filter with more
 * than 100 ids fails, as a too-long query string would.
 */

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const BIG_IDEA = "aaaaaaaa-b000-4000-8000-000000000001";
const COUNT = 1200;
const n = (i: number) => String(i).padStart(4, "0");
const chunkId = (i: number) => `chunk-${n(i)}`;
const kcId = (i: number) => `kc-${n(i)}`;
const each = <T>(make: (i: number) => T): T[] =>
  // Stored against reading order, which the readers restore.
  Array.from({ length: COUNT }, (_, i) => make(i)).toReversed();
const ofCourse = (row: FakeRow) => ({ course_id: COURSE, ...row });

function createDb() {
  return fakeSupabase({
    tables: {
      materials: [
        {
          id: MATERIAL,
          course_id: COURSE,
          name: "Lecture 1",
          media_type: "application/pdf",
          size_bytes: 1,
          created_at: "2026-01-01",
          parse_status: "parsed",
          is_exam: false,
        },
      ] as FakeRow[],
      material_pages: [] as FakeRow[],
      chunks: each((i) => ({
        id: chunkId(i),
        material_id: MATERIAL,
        position: i,
        page_from: i + 1,
        page_to: i + 1,
        markdown: `Text ${i}`,
      })),
      knowledge_map_builds: [] as FakeRow[],
      big_ideas: [
        ofCourse({ id: BIG_IDEA, name: "All", description: "", position: 0 }),
      ],
      kcs: each((i) =>
        ofCourse({
          id: kcId(i),
          big_idea_id: BIG_IDEA,
          name: `KC ${i}`,
          description: "",
          type: "concept",
          origin: "content",
          position: i,
        }),
      ),
      kc_sources: each((i) =>
        ofCourse({ kc_id: kcId(i), chunk_id: chunkId(i) }),
      ),
      prerequisite_links: each((i) =>
        ofCourse({
          id: i,
          from_kc: kcId(i),
          to_kc: kcId((i + 1) % COUNT),
        }),
      ),
      exercises: each((i) =>
        ofCourse({
          id: `exercise-${n(i)}`,
          question_chunk_id: chunkId(i),
          difficulty: 1,
          position: i,
        }),
      ),
      exercise_kcs: each((i) =>
        ofCourse({ exercise_id: `exercise-${n(i)}`, kc_id: kcId(i) }),
      ),
      exercise_solutions: [] as FakeRow[],
    },
    maxRows: 1000,
    maxInValues: 100,
  });
}

let db = createDb();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => ({ id: "student" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { getKnowledgeMap } = await import("./queries");

beforeEach(() => {
  db = createDb();
});

describe("past the row limit", () => {
  test("getKnowledgeMap gives every KC with its source, every link and Exercise", async () => {
    const view = await getKnowledgeMap(COURSE);

    const kcs = view.bigIdeas[0]?.kcs ?? [];
    expect(kcs.map((kc) => kc.id)).toEqual(
      Array.from({ length: COUNT }, (_, i) => kcId(i)),
    );
    expect(kcs.at(-1)?.sources.map((source) => source.chunkId)).toEqual([
      chunkId(COUNT - 1),
    ]);
    expect(view.prerequisites).toHaveLength(COUNT);
    expect(view.exercises).toHaveLength(COUNT);
    expect(view.exercises.at(-1)).toMatchObject({
      kcs: [kcId(COUNT - 1)],
      question: `Text ${COUNT - 1}`,
    });
  });
});
