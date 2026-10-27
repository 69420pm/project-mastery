import { describe, expect, it } from "vitest";
import {
  decodeSnapshot,
  encodeSnapshot,
  examDateIn,
  remapSnapshot,
  type Snapshot,
} from "./gold-snapshot";

const snapshot: Snapshot = {
  version: 1,
  courseName: "Probability",
  courseId: "course-old",
  pairingRequested: 0,
  tables: {
    materials: [
      {
        id: "m1",
        owner: "student-old",
        course_id: "course-old",
        storage_path: "student-old/course-old/m1",
      },
    ],
    chunks: [
      {
        id: "c1",
        owner: "student-old",
        course_id: "course-old",
        material_id: "m1",
      },
    ],
    kcs: [{ id: "k1", owner: "student-old", course_id: "course-old" }],
    kc_sources: [
      {
        owner: "student-old",
        course_id: "course-old",
        kc_id: "k1",
        chunk_id: "c1",
      },
    ],
    reading_sections: [
      {
        id: "r1",
        owner: "student-old",
        course_id: "course-old",
        chunk_ids: ["c1"],
        annotations: [{ chunk: "c1", note: "keep" }],
      },
    ],
  },
};

describe("remapSnapshot", () => {
  const { tables, materialIds } = remapSnapshot(snapshot, "student", "course");
  const first = <T>(rows: T[] | undefined) =>
    rows?.[0] as Record<string, unknown>;

  it("gives every row a new id and the new owner and Course", () => {
    const chunk = first(tables.chunks);
    expect(chunk.id).not.toBe("c1");
    expect(chunk).toMatchObject({ owner: "student", course_id: "course" });
  });

  it("rewrites foreign keys, id arrays and ids inside jsonb to the new ids", () => {
    const chunkId = first(tables.chunks).id;
    expect(first(tables.chunks).material_id).toBe(first(tables.materials).id);
    expect(first(tables.kc_sources).chunk_id).toBe(chunkId);
    expect(first(tables.kc_sources).kc_id).toBe(first(tables.kcs).id);
    expect(first(tables.reading_sections).chunk_ids).toEqual([chunkId]);
    expect(first(tables.reading_sections).annotations).toEqual([
      { chunk: chunkId, note: "keep" },
    ]);
  });

  it("points a Material at its new storage path and names its new id", () => {
    const material = first(tables.materials);
    expect(material.storage_path).toBe(`student/course/${material.id}`);
    expect(materialIds).toEqual({ m1: material.id });
  });
});

it("round-trips through the file encoding", () => {
  expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
});

it("dates the exam a number of days after today", () => {
  expect(examDateIn(42, new Date("2026-10-27T10:00:00Z"))).toBe("2026-12-08");
});
