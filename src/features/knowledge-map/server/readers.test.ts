// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { materialChunksPath } from "@/features/courses/server";
import { chunkAnchor } from "@/features/ingestion/server";
import type { Supabase } from "@/lib/supabase/types";
import {
  ANSWERED,
  BIG_IDEA,
  C1,
  C2,
  C3,
  COURSE,
  createDb,
  D1,
  EXERCISE,
  id,
  K1,
  K2,
  LECTURE,
  OPEN,
  OTHER_COURSE,
  OTHER_OPEN,
  PRIOR,
  T1,
  T2,
} from "./readers-testing";

/**
 * The Knowledge map's server reads on one seeded Course: the map view, the
 * Findings list, the Brief's review queue, the stored map an update starts
 * from and the Findings of a Material's chunks.
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
const { getFindings } = await import("./findings");
const { getOpenFindings } = await import("./review");
const { loadStoredMap } = await import("./stored-map");
const { getChunkFindings } = await import("./chunk-findings");
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
      priorKnowledge: [],
      prerequisites: [],
      semanticLinks: [],
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
    expect(thrust).toMatchObject({ id: K2, type: "procedure", bloom: "apply" });
    expect(thrust?.sources).toEqual([
      {
        chunkId: C2,
        material: "Lecture 1",
        pages: "pp. 2–3",
        link: link(LECTURE, C2),
        markdown: `Text of ${C2}`,
      },
    ]);
    expect(view.priorKnowledge.map((kc) => [kc.id, kc.sources])).toEqual([
      [PRIOR, []],
    ]);
    expect(view.prerequisites).toEqual([{ from: K1, to: K2, confidence: 0.8 }]);
    expect(view.semanticLinks).toEqual([
      { from: K2, to: K1, coreType: "causes", label: "uses" },
    ]);
    expect(view.exercises).toEqual([
      {
        id: EXERCISE,
        name: "Ex. 1",
        taskType: "compute thrust",
        kcs: [K1, K2],
        solutionStatus: "generated",
        difficulty: 2,
        question: `Text of ${C3}`,
        solution: "F = 10 N.",
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
    ["semantic_links", "Loading the semantic links failed"],
    ["exercises", "Loading the exercises failed"],
    ["exercise_kcs", "Loading the exercise KCs failed"],
  ])("throws when reading %s fails", async (table, message) => {
    failing = table;
    await expect(getKnowledgeMap(COURSE)).rejects.toThrow(`${message}: boom`);
  });
});

describe("getFindings", () => {
  test("lists open Findings before answered ones, each with its own sources", async () => {
    const findings = await getFindings(COURSE);

    expect(findings.map((f) => [f.id, f.status])).toEqual([
      [OPEN, "open"],
      [OTHER_OPEN, "open"],
      [ANSWERED, "answered"],
    ]);
    expect(findings[1]?.sources).toEqual([
      { label: "Lecture 1 p. 2", href: link(LECTURE, C2) },
    ]);
    expect(findings[2]).toMatchObject({
      answer: "It is right.",
      answeredAt: "2026-01-03",
      sources: [{ label: "Lecture 1 p. 1", href: link(LECTURE, C1) }],
    });
  });

  test.each([
    ["signed out", COURSE, false],
    ["a non-uuid id", "not-a-uuid", true],
  ])("gives none when %s", async (_, courseId, user) => {
    signedIn = user;
    expect(await getFindings(courseId)).toEqual([]);
  });

  test.each([
    ["findings", "Loading the findings failed"],
    ["finding_sources", "Loading the finding sources failed"],
  ])("throws when reading %s fails", async (table, message) => {
    failing = table;
    await expect(getFindings(COURSE)).rejects.toThrow(message);
  });
});

describe("getOpenFindings", () => {
  test("gives the open Findings with their pages in reading order", async () => {
    expect(await getOpenFindings(client(), COURSE)).toEqual([
      {
        id: OPEN,
        kind: "solution_mismatch",
        text: "Finding 1",
        sources: ["Lecture 1 p. 2", "Lecture 1 p. 4", "Notes p. 1"],
        asked: true,
      },
      {
        id: OTHER_OPEN,
        kind: "solution_mismatch",
        text: "Finding 2",
        sources: ["Lecture 1 p. 2"],
        asked: false,
      },
    ]);
  });

  test("gives none when every Finding is answered", async () => {
    for (const row of db.tables.findings) row.status = "answered";
    expect(await getOpenFindings(client(), COURSE)).toEqual([]);
  });

  test.each([
    ["findings", "Loading the findings failed"],
    ["finding_sources", "Loading the finding sources failed"],
    ["materials", "Loading the Materials failed"],
  ])("throws when reading %s fails", async (table, message) => {
    failing = table;
    await expect(getOpenFindings(client(), COURSE)).rejects.toThrow(message);
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
        whyItMatters: "It matters.",
        kcs: [{ id: K1, name: "Momentum" }],
        anchors: [],
        readingSections: [
          {
            id: id(51),
            materialId: LECTURE,
            materialName: "Lecture 1",
            pageFrom: 1,
            pageTo: 3,
            chunkIds: [C1, C2],
            mode: "annotated",
            reason: "Reason.",
            annotations: [
              { page: 2, note: "Momentum is mass times velocity." },
            ],
            studyText: null,
          },
          expect.objectContaining({ id: id(52), mode: "original" }),
        ],
      },
      expect.objectContaining({
        id: T2,
        kcs: [{ id: K2, name: "Thrust equation" }],
        anchors: [{ id: K1, name: "Momentum" }],
        readingSections: [
          expect.objectContaining({
            chunkIds: [C2],
            mode: "study_text",
            studyText: "Text. [p. 2]",
          }),
        ],
      }),
    ]);
  });

  test("gives a Topic without stored sections none", async () => {
    db.tables.reading_sections = [];
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
  test("gives the stored map with row ids, each KC and Finding with its own sources", async () => {
    const map = await loadStoredMap(client(), COURSE);

    expect(map.kcs.map((kc) => [kc.id, kc.bigIdea, kc.sources])).toEqual([
      [K1, BIG_IDEA, [C1, C2]],
      [K2, BIG_IDEA, [C2]],
      [PRIOR, null, []],
    ]);
    expect(map.prerequisites).toEqual([
      { from: K1, to: K2, extractionConfidence: 0.8 },
    ]);
    // An Exercise's KCs in map order.
    expect(map.exercises[0]).toMatchObject({
      questionChunk: C3,
      kcs: [K1, K2],
    });
    expect(map.findings.map((f) => [f.id, f.sources.toSorted()])).toEqual([
      [ANSWERED, [C1]],
      [OPEN, [C2, C3, D1].toSorted()],
      [OTHER_OPEN, [C2]],
    ]);
  });

  test("gives the answered Findings and when the build finished", async () => {
    const map = await loadStoredMap(client(), COURSE);

    expect(map.answeredFindings).toEqual([
      { text: "Finding 0", answer: "It is right.", answeredAt: "2026-01-03" },
    ]);
    expect(map.buildFinishedAt).toBe("2026-01-02");
  });

  test("gives an empty map for a Course without one", async () => {
    expect(await loadStoredMap(client(), OTHER_COURSE)).toMatchObject({
      bigIdeas: [],
      kcs: [],
      findings: [{ id: id(34), sources: [] }],
    });
  });

  test("throws when a read fails", async () => {
    failing = "kc_sources";
    await expect(loadStoredMap(client(), COURSE)).rejects.toThrow(
      "Loading the KC sources failed",
    );
  });
});

describe("getChunkFindings", () => {
  test("groups the Material's Findings by chunk, in map order", async () => {
    const answered = {
      id: ANSWERED,
      text: "Finding 0",
      status: "answered",
      answer: "It is right.",
    };
    const open = (findingId: string, text: string) => ({
      id: findingId,
      text,
      status: "open",
      answer: null,
    });
    expect(await getChunkFindings(COURSE, LECTURE)).toEqual({
      [C1]: [answered],
      [C2]: [open(OPEN, "Finding 1"), open(OTHER_OPEN, "Finding 2")],
      [C3]: [open(OPEN, "Finding 1")],
    });
  });

  test("gives none when signed out or the Material has no chunk", async () => {
    expect(await getChunkFindings(COURSE, id(99))).toEqual({});
    signedIn = false;
    expect(await getChunkFindings(COURSE, LECTURE)).toEqual({});
  });

  test.each([
    ["chunks", "Loading the chunks failed"],
    ["finding_sources", "Loading the finding sources failed"],
    ["findings", "Loading the findings failed"],
  ])("throws when reading %s fails", async (table, message) => {
    failing = table;
    await expect(getChunkFindings(COURSE, LECTURE)).rejects.toThrow(message);
  });
});
