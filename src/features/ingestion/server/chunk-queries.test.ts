// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const FILE = `${STUDENT}/${COURSE}/${MATERIAL}`;

let db = fakeSupabase({ tables: {}, userId: STUDENT });
vi.mock("@/lib/auth/user", () => ({ getUser: async () => ({ id: STUDENT }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => db as unknown as Supabase,
}));

const { getMaterialChunks } = await import("./chunk-queries");

beforeEach(() => {
  db = fakeSupabase({
    tables: {
      materials: [
        {
          id: MATERIAL,
          course_id: COURSE,
          name: "Lecture 1",
          media_type: "application/pdf",
          storage_path: FILE,
          parse_status: "parsed",
          is_exam: false,
        },
      ] as FakeRow[],
      chunks: [
        {
          id: "c1",
          material_id: MATERIAL,
          position: 0,
          page_from: 1,
          page_to: 1,
          label: "content",
          markdown: "Plot",
          exercise_number: null,
        },
        {
          id: "c2",
          material_id: MATERIAL,
          position: 1,
          page_from: 2,
          page_to: 2,
          label: "content",
          markdown: "Text",
          exercise_number: null,
        },
      ] as FakeRow[],
      exercise_solutions: [] as FakeRow[],
    },
    userId: STUDENT,
  });
  db.files.seed("course-files", FILE, {
    body: new Uint8Array([1]),
    contentType: "application/pdf",
  });
});

test("an exercise carries its paired solution in another Material, or no solution", async () => {
  const SOLUTIONS = "aaaaaaaa-0000-4000-8000-000000000051";
  const exercise = (id: string, position: number, number: string) => ({
    id,
    material_id: MATERIAL,
    position,
    page_from: 3,
    page_to: 3,
    label: "exercise",
    markdown: `Exercise ${number}`,
    exercise_number: number,
  });
  const tables = db.tables as Record<string, FakeRow[]>;
  tables.materials!.push({
    id: SOLUTIONS,
    course_id: COURSE,
    name: "Solutions 7",
    parse_status: "parsed",
  });
  tables.chunks!.push(exercise("e1", 2, "7.2a"), exercise("e2", 3, "7.2b"), {
    id: "s1",
    material_id: SOLUTIONS,
    position: 0,
    page_from: 1,
    page_to: 1,
    label: "solution",
    markdown: "Since ...",
    exercise_number: "7.2 a)",
  });
  tables.exercise_solutions!.push(
    { exercise_chunk_id: "e1", solution_chunk_id: "s1", status: "paired" },
    { exercise_chunk_id: "e2", solution_chunk_id: null, status: "no_solution" },
  );

  const material = await getMaterialChunks(MATERIAL);

  const [text, , first, second] = material?.chunks ?? [];
  expect(first?.solution).toEqual({
    status: "paired",
    chunkId: "s1",
    materialId: SOLUTIONS,
    materialName: "Solutions 7",
    exerciseNumber: "7.2 a)",
  });
  expect(second?.solution).toEqual({ status: "no_solution" });
  expect(text?.solution).toBeNull();
});

test("a Material past the row limit comes back whole, each exercise with its solution", async () => {
  const exercises = Array.from({ length: 1200 }, (_, i) => ({
    id: `e${String(i).padStart(4, "0")}`,
    material_id: MATERIAL,
    position: 2 + i,
    page_from: 3,
    page_to: 3,
    label: "exercise",
    markdown: `Exercise ${i}`,
    exercise_number: String(i),
  }));
  const tables = db.tables as Record<string, FakeRow[]>;
  db = fakeSupabase({
    tables: {
      ...tables,
      // Stored against reading order, which the read restores.
      chunks: [...exercises.toReversed(), ...tables.chunks!],
      exercise_solutions: exercises.map((exercise) => ({
        exercise_chunk_id: exercise.id,
        solution_chunk_id: null,
        status: "no_solution",
      })),
    },
    userId: STUDENT,
    maxRows: 1000,
    maxInValues: 100,
  });

  const material = await getMaterialChunks(MATERIAL);

  expect(material?.chunks).toHaveLength(1202);
  expect(material?.chunks.map((chunk) => chunk.position)).toEqual(
    Array.from({ length: 1202 }, (_, i) => i),
  );
  expect(material?.chunks.at(-1)?.solution).toEqual({ status: "no_solution" });
});
