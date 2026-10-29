import { describe, expect, test } from "vitest";
import {
  batches,
  exerciseSubtasks,
  keyedChunks,
  nameStem,
  pairInCode,
  partnerMaterials,
  shortlist,
  type PairingMaterial,
} from "./exercise-pairing";

/** A Material whose chunks are `e:7` (exercise 7), `s:7` or `s:` (no number). */
const material = (id: string, name: string, chunks: string[]) => ({
  id,
  name,
  chunks: chunks.map((spec, index) => {
    const [kind, number] = spec.split(":");
    return {
      id: `${id}-${kind}${number || `#${index}`}`,
      label: kind === "e" ? ("exercise" as const) : ("solution" as const),
      exerciseNumber: number || null,
    };
  }),
});

function pair(materials: PairingMaterial[]) {
  const chunks = keyedChunks(materials);
  const partners = partnerMaterials(materials, chunks);
  return { chunks, partners, ...pairInCode(chunks, partners) };
}

const ids = (chunks: Array<{ id: string }>) => chunks.map((chunk) => chunk.id);

describe("pairing in one Material", () => {
  test("pairs the gold exercise collection by key and leaves the others without a candidate", () => {
    const collection = material("m", "exercises.pdf", [
      ...["7", "8", "9", "10", "11", "12", "13", "14", "15", "16"].map(
        (n) => `e:${n}`,
      ),
      ...["3", "6", "8", "9", "10", "14", "15", "18", "21"].map(
        (n) => `s:${n}`,
      ),
    ]);
    const { pairs, exercises, solutions, partners, chunks } = pair([
      collection,
    ]);

    expect(pairs.map((p) => `${p.exerciseId}>${p.solutionId}`)).toEqual(
      ["8", "9", "10", "14", "15"].map((n) => `m-e${n}>m-s${n}`),
    );
    expect(ids(exercises)).toEqual(
      ["7", "11", "12", "13", "16"].map((n) => `m-e${n}`),
    );
    // Solutions to exercises the Material numbers otherwise are no
    // candidates, so no call is made.
    const vectors = new Map(chunks.map((chunk) => [chunk.id, [1, 0]]));
    for (const exercise of exercises) {
      expect(shortlist(exercise, solutions, partners, vectors)).toEqual([]);
    }
  });

  test("pairs each exam's Problems with their own solutions when two exams repeat the numbers", () => {
    const exams = material("m", "past-exams.pdf", [
      "e:1",
      "e:2a",
      "e:2b",
      "s:1",
      "s:2",
      "e:1",
      "e:2",
      "s:1",
      "s:2",
    ]);
    // Ids repeat in the helper, so give the Resit its own.
    exams.chunks.slice(5).forEach((chunk) => (chunk.id += "-resit"));

    expect(pair([exams]).pairs).toEqual([
      { exerciseId: "m-e1", solutionId: "m-s1" },
      { exerciseId: "m-e2a", solutionId: "m-s2" },
      { exerciseId: "m-e2b", solutionId: "m-s2" },
      { exerciseId: "m-e1-resit", solutionId: "m-s1-resit" },
      { exerciseId: "m-e2-resit", solutionId: "m-s2-resit" },
    ]);
  });

  test("leaves an exercise whose window holds two solutions with its key", () => {
    const { pairs, exercises } = pair([
      material("m", "Sheet", ["e:1", "s:1", "s:1"]),
    ]);
    expect(pairs).toEqual([]);
    expect(ids(exercises)).toEqual(["m-e1"]);
  });
});

describe("partner Materials", () => {
  test("names match without case, punctuation and the solution words", () => {
    expect(nameStem("Blatt 3 – Musterlösung.pdf")).toBe(
      nameStem("blatt_3.pdf"),
    );
    expect(nameStem("Exercises Solutions")).toBe(nameStem("Exercises"));
    expect(nameStem("Sheet 3")).not.toBe(nameStem("Sheet 4"));
  });

  test("pairs Exercises with Exercises Solutions by key, an ancestor key too", () => {
    const { pairs, exercises } = pair([
      material("ex", "Exercises", ["e:7", "e:8a", "e:8b", "e:9"]),
      material("sol", "Exercises Solutions", ["s:7", "s:8"]),
    ]);
    expect(pairs).toEqual([
      { exerciseId: "ex-e7", solutionId: "sol-s7" },
      { exerciseId: "ex-e8a", solutionId: "sol-s8" },
      { exerciseId: "ex-e8b", solutionId: "sol-s8" },
    ]);
    expect(ids(exercises)).toEqual(["ex-e9"]);
  });

  test("a solution-only Material is the partner of the one Material its keys cover", () => {
    const materials = [
      material("sheet", "Sheet 7", ["e:7.1", "e:7.2a", "e:7.2b"]),
      material("other", "Sheet 8", ["e:8.1", "e:8.2"]),
      material("answers", "Answers", ["s:7.1", "s:7.2"]),
    ];
    const { partners, pairs } = pair(materials);
    expect([...partners.get("answers")!]).toEqual(["sheet"]);
    expect(pairs).toHaveLength(3);
  });

  test("covering two Materials makes no partner", () => {
    const { partners, pairs } = pair([
      material("a", "Sheet A", ["e:1", "e:2"]),
      material("b", "Sheet B", ["e:1", "e:2"]),
      material("answers", "Answers", ["s:1", "s:2"]),
    ]);
    expect(partners.get("answers")!.size).toBe(0);
    expect(pairs).toEqual([]);
  });

  test("an exercise whose key repeats in its Material is left for the content call", () => {
    const { pairs } = pair([
      material("ex", "Exercises", ["e:1", "e:1"]),
      material("sol", "Exercises Lösung", ["s:1"]),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe("shortlist", () => {
  const sheet = material("sheet", "Sheet 1", ["e:3a"]);
  const others = material("pool", "Pool", [
    "s:",
    "s:3",
    "s:3a",
    "s:3",
    "s:3",
    "s:5",
    "s:",
    "s:",
    "s:",
  ]);
  others.chunks.forEach((chunk, index) => (chunk.id = `s${index}`));
  const chunks = keyedChunks([sheet, others]);
  const [exercise, ...solutions] = chunks;
  const partners = new Map([
    ["sheet", new Set<string>()],
    ["pool", new Set<string>()],
  ]);
  // Cosine to the exercise's [1, 0] falls with the index, under 0.5 from s7.
  const vectors = new Map([
    ["sheet-e3a", [1, 0]],
    ...solutions.map(
      (solution, index) =>
        [solution.id, [1 - index * 0.1, index * 0.1 + 0.05]] as [
          string,
          number[],
        ],
    ),
  ]);
  vectors.set("s8", [0, 1]);

  test("puts up to 3 with the key first, then the nearest, at cosine 0.5 or more", () => {
    expect(ids(shortlist(exercise!, solutions, partners, vectors))).toEqual([
      "s1",
      "s2",
      "s3",
      "s0",
      "s4",
      "s5",
    ]);
  });

  test("leaves out a differently numbered solution of a partner", () => {
    const linked = new Map([
      ["sheet", new Set(["pool"])],
      ["pool", new Set(["sheet"])],
    ]);
    expect(ids(shortlist(exercise!, solutions, linked, vectors))).toEqual([
      "s1",
      "s2",
      "s3",
      "s0",
      "s4",
      "s6",
    ]);
  });
});

test("batches hold 10 exercises", () => {
  expect(
    batches(Array.from({ length: 23 }, (_, i) => i)).map((b) => b.length),
  ).toEqual([10, 10, 3]);
});

test("a statement its Material splits into subtasks is no subtask", () => {
  const chunks = keyedChunks([
    material("m", "Sheet", ["e:7.2", "e:7.2a", "e:7.2b", "e:7.3"]),
    material("m2", "Other", ["e:7.2"]),
  ]);
  expect(ids(exerciseSubtasks(chunks))).toEqual([
    "m-e7.2a",
    "m-e7.2b",
    "m-e7.3",
    "m2-e7.2",
  ]);
});
