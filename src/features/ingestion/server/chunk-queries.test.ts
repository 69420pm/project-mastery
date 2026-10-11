// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const CROP = `${STUDENT}/${COURSE}/${MATERIAL}/figures/1-0.png`;

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
          parse_status: "parsed",
          is_exam: false,
          exam_year: null,
          exam_total_points: null,
        },
      ] as FakeRow[],
      chunks: [
        {
          id: "c1",
          material_id: MATERIAL,
          position: 0,
          page_from: 1,
          page_to: 1,
          label: "figure",
          markdown: "Plot",
          figure: { description: "A parabola.", cropPath: CROP },
          exercise_number: null,
          points: null,
        },
        {
          id: "c2",
          material_id: MATERIAL,
          position: 1,
          page_from: 2,
          page_to: 2,
          label: "content",
          markdown: "Text",
          figure: null,
          exercise_number: null,
          points: null,
        },
      ] as FakeRow[],
    },
    userId: STUDENT,
  });
  db.files.seed("course-files", CROP, {
    body: new Uint8Array([1]),
    contentType: "image/png",
  });
});

test("a figure chunk carries a short-lived signed URL for its picture, with its description", async () => {
  const material = await getMaterialChunks(MATERIAL);

  const [figure, text] = material?.chunks ?? [];
  expect(figure?.figure).toEqual({
    description: "A parabola.",
    cropPath: CROP,
    imageUrl: expect.stringContaining(`/course-files/${CROP}?`),
  });
  expect(figure?.figure?.imageUrl).toContain("expiresIn=3600");
  expect(text?.figure).toBeNull();
});
