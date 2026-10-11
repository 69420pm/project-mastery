// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const { removeCourseFiles, removeMaterialFiles } =
  await import("./material-store");

/**
 * The files the delete actions remove with a Material or Course: its upload
 * and everything its parse stored under it (page images, figure crops).
 */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const BUCKET = "course-files";
const COURSE = `${STUDENT}/course-1`;
const LECTURE = `${COURSE}/material-1`;
const SHEET = `${COURSE}/material-2`;

function seededStorage(paths: string[]) {
  const db = fakeSupabase({ tables: {}, userId: STUDENT });
  for (const path of paths) {
    db.files.seed(BUCKET, path, { body: "x", contentType: "image/png" });
  }
  return db;
}

describe("removeMaterialFiles", () => {
  test("removes the Material's file with its page images and figure crops, and nothing else", async () => {
    const db = seededStorage([
      LECTURE,
      `${LECTURE}/pages/1.png`,
      `${LECTURE}/pages/2.png`,
      `${LECTURE}/figures/1-0.png`,
      SHEET,
      `${SHEET}/pages/1.png`,
    ]);

    const removed = await removeMaterialFiles(
      db as unknown as Supabase,
      LECTURE,
    );

    expect(removed).toBe(true);
    expect(db.files.paths(BUCKET).toSorted()).toEqual([
      SHEET,
      `${SHEET}/pages/1.png`,
    ]);
  });

  test("reports a Storage failure", async () => {
    const db = seededStorage([LECTURE, `${LECTURE}/pages/1.png`]);
    db.files.fail("remove");

    expect(await removeMaterialFiles(db as unknown as Supabase, LECTURE)).toBe(
      false,
    );
  });
});

describe("removeCourseFiles", () => {
  test("removes the files of every Material in the Course, with their page images and figure crops", async () => {
    const db = seededStorage([
      LECTURE,
      `${LECTURE}/pages/1.png`,
      `${LECTURE}/figures/1-0.png`,
      SHEET,
      `${STUDENT}/course-2/material-3`,
    ]);

    const removed = await removeCourseFiles(
      db as unknown as Supabase,
      STUDENT,
      "course-1",
    );

    expect(removed).toBe(true);
    expect(db.files.paths(BUCKET)).toEqual([`${STUDENT}/course-2/material-3`]);
  });
});
