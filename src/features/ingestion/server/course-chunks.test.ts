// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ getUser: async () => ({ id: "me" }) }));

const { loadCourseChunks, loadChunkSources, getChunkPlaces } =
  await import("./course-chunks");

const COURSE = "course-1";

const material = (
  id: string,
  createdAt: string,
  parseStatus = "parsed",
  courseId = COURSE,
): FakeRow => ({
  id,
  course_id: courseId,
  name: `Material ${id}`,
  parse_status: parseStatus,
  created_at: createdAt,
  is_exam: false,
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
    exercise_number: null,
  })).reverse();

/**
 * The fake with PostgREST's limits: at most 1,000 rows per response. Records
 * the length of every `in` list, which must stay short for the query string.
 */
function withRowLimit(tables: { materials: FakeRow[]; chunks: FakeRow[] }) {
  const db = fakeSupabase({ tables });
  const inLengths: number[] = [];
  const client = {
    ...db,
    from(table: "materials" | "chunks") {
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

let tables: { materials: FakeRow[]; chunks: FakeRow[] };
beforeEach(() => {
  tables = {
    materials: [
      material("b", "2026-01-02"),
      material("a", "2026-01-01"),
      material("unparsed", "2026-01-03", "parsing"),
      material("other", "2026-01-01", "parsed", "course-2"),
    ],
    chunks: [
      ...chunksOf("b", 2),
      ...chunksOf("a", 1500),
      ...chunksOf("unparsed", 3),
      ...chunksOf("other", 3),
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
      exerciseNumber: null,
    });
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
      isExam: false,
    });
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
