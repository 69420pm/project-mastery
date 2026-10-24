// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { materialChunksPath } from "@/features/courses/server";
import { chunkAnchor } from "@/features/ingestion/server";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The Knowledge map's server reads on one seeded Course: the map view, the
 * Findings list, the Brief's review queue, the stored map an update starts
 * from and the Findings of a Material's chunks.
 */

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const OTHER_COURSE = "aaaaaaaa-c000-4000-8000-000000000002";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [LECTURE, NOTES] = [id(1), id(2)];
// c1–c3 are Lecture 1's pages 1, 2–3 and 4; d1 is page 1 of the later Notes.
const [C1, C2, C3, D1] = [id(11), id(12), id(13), id(14)];
const [BIG_IDEA, K1, K2, PRIOR, EXERCISE] = [
  id(21),
  id(22),
  id(23),
  id(24),
  id(25),
];
const [ANSWERED, OPEN, OTHER_OPEN] = [id(31), id(32), id(33)];
const [T1, T2] = [id(41), id(42)];
const topicText = (name: string) => ({
  course_id: COURSE,
  name,
  central_question: `${name}?`,
  why_it_matters: "It matters.",
});

let signedIn = true;
let failing: string | undefined;
let db = createDb();

function createDb() {
  const material = (materialId: string, name: string, createdAt: string) => ({
    id: materialId,
    course_id: COURSE,
    name,
    media_type: "application/pdf",
    size_bytes: 1,
    created_at: createdAt,
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
  const finding = (
    findingId: string,
    position: number,
    status: string,
    askedAt: string | null,
  ) => ({
    id: findingId,
    course_id: COURSE,
    kind: "solution_mismatch",
    text: `Finding ${position}`,
    status,
    answer: status === "answered" ? "It is right." : null,
    asked_at: askedAt,
    answered_at: status === "answered" ? "2026-01-03" : null,
    position,
  });
  const ofCourse = (rows: FakeRow[]) =>
    rows.map((row) => ({ course_id: COURSE, ...row }));
  return fakeSupabase({
    tables: {
      materials: [
        material(NOTES, "Notes", "2026-01-02"),
        material(LECTURE, "Lecture 1", "2026-01-01"),
      ],
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
            uncoveredChunkIds: [D1],
            ungroundedKcs: [],
            orphanKcs: [],
            droppedCycleEdges: [],
          },
        },
      ]),
      big_ideas: ofCourse([
        { id: BIG_IDEA, name: "Thrust", description: "Force.", position: 0 },
      ]),
      kcs: ofCourse([
        {
          id: PRIOR,
          big_idea_id: null,
          name: "Newton",
          description: "F = ma.",
          type: "prior",
          bloom: null,
          origin: "prior",
          position: 2,
        },
        {
          id: K2,
          big_idea_id: BIG_IDEA,
          name: "Thrust equation",
          description: "F = m(v2 - v1).",
          type: "procedure",
          bloom: "apply",
          origin: "content",
          position: 1,
        },
        {
          id: K1,
          big_idea_id: BIG_IDEA,
          name: "Momentum",
          description: "m v.",
          type: "concept",
          bloom: "understand",
          origin: "content",
          position: 0,
        },
      ]),
      kc_sources: ofCourse([
        { kc_id: K2, chunk_id: C2 },
        { kc_id: K1, chunk_id: C1 },
        { kc_id: K1, chunk_id: C2 },
      ]),
      prerequisite_links: ofCourse([
        // Postgres returns a numeric as text.
        { id: 1, from_kc: K1, to_kc: K2, extraction_confidence: "0.8" },
      ]),
      semantic_links: ofCourse([
        { id: 1, from_kc: K2, to_kc: K1, core_type: "causes", label: "uses" },
      ]),
      exercises: ofCourse([
        {
          id: EXERCISE,
          question_chunk_id: C3,
          name: "Ex. 1",
          task_type: "compute thrust",
          solution_status: "generated",
          solution: "F = 10 N.",
          difficulty: 2,
          position: 0,
        },
      ]),
      exercise_kcs: ofCourse([
        { exercise_id: EXERCISE, kc_id: K2 },
        { exercise_id: EXERCISE, kc_id: K1 },
      ]),
      exercise_solutions: [] as FakeRow[],
      findings: [
        finding(ANSWERED, 0, "answered", "2026-01-02"),
        finding(OPEN, 1, "open", "2026-01-02"),
        finding(OTHER_OPEN, 2, "open", null),
        {
          ...finding(id(34), 0, "open", null),
          course_id: OTHER_COURSE,
        },
      ],
      finding_sources: ofCourse([
        { finding_id: ANSWERED, chunk_id: C1 },
        { finding_id: OPEN, chunk_id: D1 },
        { finding_id: OPEN, chunk_id: C3 },
        { finding_id: OPEN, chunk_id: C2 },
        { finding_id: OTHER_OPEN, chunk_id: C2 },
      ]),
      knowledge_map_chunks: [] as FakeRow[],
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
    foreignKeys: { topic_kcs: { topic_id: "topics" } },
  });
}

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
        readingSections: [expect.objectContaining({ chunkIds: [C2] })],
      }),
    ]);
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
