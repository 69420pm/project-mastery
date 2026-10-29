// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { materialChunksPath } from "@/features/courses/server";
import { chunkAnchor } from "@/features/ingestion/server";
import { readingSectionId } from "@/features/knowledge-map/domain/topic-reading";
import type { Supabase } from "@/lib/supabase/types";
import {
  BIG_IDEA,
  C1,
  C2,
  C3,
  COURSE,
  D1,
  createDb,
  EXERCISE,
  id,
  K1,
  K2,
  LECTURE,
  OTHER_COURSE,
  K3,
  T1,
  T2,
} from "./readers-testing";

/**
 * The Knowledge map's server reads on one seeded Course: the map view, the
 * Course's Topics and the stored map an update starts from.
 */

let signedIn = true;
let failing: string | undefined;
let db = createDb();

/** The client, whose reads of the `failing` table fail. */
function client() {
  return {
    ...db,
    from(table: Parameters<typeof db.from>[0]) {
      const builder = db.from(table);
      if (table === failing) {
        builder.then = (resolve, reject) =>
          Promise.resolve({ data: null, error: { code: "", message: "boom" } })
            .then(resolve)
            .catch(reject);
      }
      return builder;
    },
  } as unknown as Supabase;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: "student" } : null),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client(),
}));

const { getKnowledgeMap } = await import("./queries");
const { loadStoredMap } = await import("./stored-map");
const { loadCourseTopics } = await import("./course-topics");

beforeEach(() => {
  signedIn = true;
  failing = undefined;
  db = createDb();
});

const link = (materialId: string, chunkId: string) =>
  `${materialChunksPath(COURSE, materialId)}#${chunkAnchor(chunkId)}`;

describe("getKnowledgeMap", () => {
  test.each([
    ["signed out", COURSE, false],
    ["a non-uuid id", "not-a-uuid", true],
  ])("gives the empty view when %s", async (_, courseId, user) => {
    signedIn = user;
    expect(await getKnowledgeMap(courseId)).toEqual({
      courseId,
      build: null,
      bigIdeas: [],
      prerequisites: [],
      exercises: [],
      checkReport: null,
      canBuild: false,
    });
  });

  test("gives each KC only its own sources, in reading order", async () => {
    const view = await getKnowledgeMap(COURSE);

    expect(view.build).toEqual({
      status: "built",
      failureReason: null,
      finishedAt: "2026-01-02",
    });
    expect(view.canBuild).toBe(true);
    const [momentum, thrust] = view.bigIdeas[0]?.kcs ?? [];
    expect(momentum?.sources.map((s) => [s.chunkId, s.pages])).toEqual([
      [C1, "p. 1"],
      [C2, "pp. 2–3"],
    ]);
    expect(thrust).toMatchObject({ id: K2, type: "procedure" });
    expect(thrust?.sources).toEqual([
      {
        chunkId: C2,
        material: "Lecture 1",
        pages: "pp. 2–3",
        link: link(LECTURE, C2),
        markdown: `Text of ${C2}`,
      },
    ]);
    expect(view.prerequisites).toEqual([{ from: K1, to: K2 }]);
    // Labelled by where its question is printed; no solution is paired.
    expect(view.exercises).toEqual([
      {
        id: EXERCISE,
        name: "Lecture 1 p. 4",
        kcs: [K1, K2],
        difficulty: 2,
        question: `Text of ${C3}`,
        solution: null,
      },
    ]);
    expect(view.checkReport?.uncoveredChunks).toEqual(["Notes p. 1"]);
  });

  test.each([
    ["knowledge_map_builds", "Loading the build failed"],
    ["big_ideas", "Loading the big ideas failed"],
    ["kcs", "Loading the KCs failed"],
    ["kc_sources", "Loading the KC sources failed"],
    ["prerequisite_links", "Loading the prerequisites failed"],
    ["exercises", "Loading the exercises failed"],
    ["exercise_kcs", "Loading the exercise KCs failed"],
  ])("throws when reading %s fails", async (table, message) => {
    failing = table;
    await expect(getKnowledgeMap(COURSE)).rejects.toThrow(`${message}: boom`);
  });
});

describe("loadCourseTopics", () => {
  test("gives the Course's Topics in order with anchors and Reading sections", async () => {
    const topics = await loadCourseTopics(COURSE);

    expect(topics).toEqual([
      {
        id: T1,
        bigIdeaId: BIG_IDEA,
        name: "One",
        centralQuestion: "One?",
        kcs: [{ id: K1, name: "Momentum" }],
        anchors: [],
        readingSections: [
          {
            id: readingSectionId(T1, {
              materialId: LECTURE,
              pageFrom: 1,
              pageTo: 3,
            }),
            materialId: LECTURE,
            materialName: "Lecture 1",
            pageFrom: 1,
            pageTo: 3,
            chunkIds: [C1, C2],
          },
        ],
      },
      expect.objectContaining({
        id: T2,
        kcs: [{ id: K2, name: "Thrust equation" }],
        anchors: [{ id: K1, name: "Momentum" }],
        readingSections: [
          expect.objectContaining({ chunkIds: [C2], pageFrom: 2, pageTo: 3 }),
        ],
      }),
    ]);
  });

  test("keeps section ids across reads and over an unrelated map update", async () => {
    const ids = async () =>
      (await loadCourseTopics(COURSE)).map((topic) =>
        topic.readingSections.map((section) => section.id),
      );
    const before = await ids();
    expect(await ids()).toEqual(before);

    // Thrust equation now also cites a page of the later Notes.
    db.tables.kc_sources.push({ course_id: COURSE, kc_id: K2, chunk_id: D1 });
    const after = await ids();
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual([before[1]![0], expect.any(String)]);
    expect(after[1]![1]).not.toBe(before[1]![0]);
  });

  test("gives a Topic whose KCs cite no chunk no sections", async () => {
    db.tables.kc_sources = [];
    const topics = await loadCourseTopics(COURSE);
    expect(topics.map((topic) => topic.readingSections)).toEqual([[], []]);
  });

  test.each([
    ["signed out", COURSE, false],
    ["a non-uuid id", "not-a-uuid", true],
    ["a Course without Topics", id(99), true],
  ])("gives none for %s", async (_, courseId, user) => {
    signedIn = user;
    expect(await loadCourseTopics(courseId)).toEqual([]);
  });
});

describe("loadStoredMap", () => {
  test("gives the stored map with row ids, each KC with its own sources", async () => {
    const map = await loadStoredMap(client(), COURSE);

    expect(map.kcs.map((kc) => [kc.id, kc.bigIdea, kc.sources])).toEqual([
      [K1, BIG_IDEA, [C1, C2]],
      [K2, BIG_IDEA, [C2]],
      [K3, BIG_IDEA, []],
    ]);
    expect(map.prerequisites).toEqual([{ from: K1, to: K2 }]);
    // An Exercise's KCs in map order.
    expect(map.exercises[0]).toMatchObject({
      questionChunk: C3,
      kcs: [K1, K2],
    });
  });

  test("gives an empty map for a Course without one", async () => {
    expect(await loadStoredMap(client(), OTHER_COURSE)).toMatchObject({
      bigIdeas: [],
      kcs: [],
    });
  });

  test("throws when a read fails", async () => {
    failing = "kc_sources";
    await expect(loadStoredMap(client(), COURSE)).rejects.toThrow(
      "Loading the KC sources failed",
    );
  });
});
