// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ getUser: async () => ({ id: "me" }) }));

const {
  loadCourseChunks,
  loadChunkSources,
  getChunkPlaces,
  loadChunkMaterials,
} = await import("./course-chunks");

const COURSE = "course-1";

/** A Material at `position` in Course order. */
const material = (
  id: string,
  position: number,
  parseStatus = "parsed",
  courseId = COURSE,
): FakeRow => ({
  id,
  course_id: courseId,
  name: `Material ${id}`,
  parse_status: parseStatus,
  position,
});

const chapter = (
  id: string,
  parentId: string | null,
  depth: number,
  title: string,
  isExam: boolean | null = null,
): FakeRow => ({
  id,
  course_id: COURSE,
  material_id: "a",
  parent_id: parentId,
  depth,
  title,
  is_exam: isExam,
});

/** `count` chunks of `materialId`, stored in reverse reading order. */
const chunksOf = (materialId: string, count: number): FakeRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${materialId}-${String(i).padStart(4, "0")}`,
    material_id: materialId,
    position: i,
    page_from: 1,
    page_to: 1,
    label: "content",
    markdown: `text ${i}`,
    chapter_id: null,
  })).reverse();

/**
 * The fake with PostgREST's limits: at most 1,000 rows per response. Records
 * the length of every `in` list, which must stay short for the query string.
 */
function withRowLimit(tables: {
  materials: FakeRow[];
  chunks: FakeRow[];
  chapters: FakeRow[];
}) {
  const db = fakeSupabase({ tables });
  const inLengths: number[] = [];
  const client = {
    ...db,
    from(table: "materials" | "chunks" | "chapters") {
      const builder = db.from(table);
      const { in: filterIn, then } = builder;
      builder.in = (column, values) => {
        inLengths.push(values.length);
        return filterIn(column, values);
      };
      builder.then = (resolve, reject) =>
        then(
          (result) =>
            resolve!({
              ...result,
              data: Array.isArray(result.data)
                ? result.data.slice(0, 1000)
                : result.data,
            }),
          reject,
        );
      return builder;
    },
  };
  return { client, inLengths };
}

let tables: { materials: FakeRow[]; chunks: FakeRow[]; chapters: FakeRow[] };
beforeEach(() => {
  tables = {
    materials: [
      material("b", 1),
      material("a", 0),
      material("unparsed", 2, "parsing"),
      material("other", 0, "parsed", "course-2"),
    ],
    chunks: [
      ...chunksOf("b", 2),
      ...chunksOf("a", 1500),
      ...chunksOf("unparsed", 3),
      ...chunksOf("other", 3),
    ],
    // Material a: 4 Vector Spaces, and an old exam with a problem inside.
    chapters: [
      chapter("root-a", null, 0, "Material a"),
      chapter("c4", "root-a", 1, "4 Vector Spaces"),
      chapter("exam", "root-a", 1, "Klausur 2023", true),
      chapter("problem", "exam", 2, "Aufgabe 1"),
    ],
  };
});

describe("loadCourseChunks", () => {
  test("reads every chunk of the parsed Materials, in reading order", async () => {
    const { client } = withRowLimit(tables);

    const chunks = await loadCourseChunks(
      client as unknown as AdminSupabase,
      COURSE,
    );

    expect(chunks.map((chunk) => chunk.id)).toEqual([
      ...chunksOf("a", 1500)
        .reverse()
        .map((chunk) => chunk.id),
      "b-0000",
      "b-0001",
    ]);
    expect(chunks[0]).toEqual({
      id: "a-0000",
      materialId: "a",
      materialName: "Material a",
      pageFrom: 1,
      label: "content",
      markdown: "text 0",
    });
  });
});

describe("loadChunkMaterials", () => {
  test("reads every chunk of the Course with its Material, and the old-exam chunks", async () => {
    tables.chunks = tables.chunks.map((chunk) => ({
      ...chunk,
      course_id: chunk.material_id === "other" ? "course-2" : COURSE,
      chapter_id:
        chunk.id === "a-0001"
          ? "problem"
          : chunk.id === "a-0002"
            ? "exam"
            : chunk.id === "a-0003"
              ? "c4"
              : null,
    }));
    const { client } = withRowLimit(tables);

    const { chunkMaterials, materials, examChunkIds } =
      await loadChunkMaterials(client as unknown as Supabase, COURSE);

    expect(Object.keys(chunkMaterials)).toHaveLength(1505);
    expect(chunkMaterials["b-0001"]).toBe("b");
    expect(materials.b).toEqual({ name: "Material b" });
    // The exam Chapter and the problem inside it; not 4 Vector Spaces.
    expect(examChunkIds.toSorted()).toEqual(["a-0001", "a-0002"]);
  });
});

describe("loadChunkSources and getChunkPlaces", () => {
  const ids = [
    "b-0001",
    "missing",
    ...Array.from(
      { length: 150 },
      (_, i) => `a-${String(149 - i).padStart(4, "0")}`,
    ),
    "b-0000",
    "a-0000",
  ];

  test("read more than 100 ids whole, skipping missing ones", async () => {
    const chapterOf = (id: string, chapterId: string) => {
      tables.chunks.find((chunk) => chunk.id === id)!.chapter_id = chapterId;
    };
    chapterOf("a-0000", "c4");
    chapterOf("a-0001", "root-a");
    chapterOf("a-0002", "problem");
    const { client, inLengths } = withRowLimit(tables);

    const sources = await loadChunkSources(client as unknown as Supabase, ids);
    const places = await getChunkPlaces(ids, client as unknown as Supabase);

    expect(sources.map((source) => source.id)).toEqual([
      ...Array.from(
        { length: 150 },
        (_, i) => `a-${String(i).padStart(4, "0")}`,
      ),
      "b-0000",
      "b-0001",
    ]);
    expect(sources[0]).toMatchObject({
      materialName: "Material a",
      pageTo: 1,
      chapterTitle: "4 Vector Spaces",
      isExam: false,
    });
    // A Material's root Chapter is no Chapter title.
    expect(sources[1]!.chapterTitle).toBeNull();
    // A chunk inside an old-exam Chapter is an old-exam chunk.
    expect(sources[2]).toMatchObject({
      chapterTitle: "Aufgabe 1",
      isExam: true,
    });
    expect(sources.slice(3).map((source) => source.chapterTitle)).toEqual(
      sources.slice(3).map(() => null),
    );
    expect(places).toHaveLength(152);
    expect(new Set(places.map((place) => place.id))).toEqual(
      new Set(sources.map((source) => source.id)),
    );
    expect(Math.max(...inLengths)).toBeLessThanOrEqual(100);
  });

  test("give nothing when no id is found", async () => {
    const { client } = withRowLimit(tables);

    await expect(
      loadChunkSources(client as unknown as Supabase, ["missing"]),
    ).resolves.toEqual([]);
    await expect(
      getChunkPlaces([], client as unknown as Supabase),
    ).resolves.toEqual([]);
  });
});
