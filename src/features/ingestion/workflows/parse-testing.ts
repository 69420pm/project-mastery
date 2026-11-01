import { readFile } from "node:fs/promises";
import path from "node:path";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { vi } from "vitest";
import {
  mockEmbeddingModel,
  useMockModels as useModels,
} from "@/lib/ai/testing";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the parse workflow in-process (`parse-material.ts`): the
 * admin client as a `fakeSupabase`, a seeded Material, and an `ingest` model
 * with canned batch results. Each test file mocks
 * `@/lib/supabase/admin` with its own `db`:
 *
 *   let db = createParseDb();
 *   vi.mock("@/lib/supabase/admin", () => ({
 *     createAdminClient: () => markAdminClient(db as unknown as Supabase),
 *   }));
 */

export const STUDENT = "11111111-1111-1111-1111-111111111111";
export const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
export const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
export const STORAGE_PATH = `${STUDENT}/${COURSE}/${MATERIAL}`;
export const BUCKET = MATERIALS_BUCKET;

/**
 * `useMockModels` for a parse test: the `embed` task answers too, unless the
 * test gives its own, because every parse ends by embedding its chunks. One
 * batch call runs at a time, so canned batch results answer batches in order.
 */
export function useMockModels(models: Parameters<typeof useModels>[0]) {
  useModels({ embed: mockEmbeddingModel(), ...models });
  vi.stubEnv("AI_CONCURRENCY", "1");
}

type ParseTable =
  | "courses"
  | "materials"
  | "material_pages"
  | "chapters"
  | "chunks"
  | "exercise_solutions"
  | "ai_usage";

/**
 * The admin client a workflow has: no session, no Row Level Security.
 * `canAccess` lets a test make writes to a table fail.
 */
export function createParseDb({
  canAccess,
}: {
  canAccess?: (table: ParseTable) => boolean;
} = {}) {
  return fakeSupabase<ParseTable>({
    canAccess,
    tables: {
      courses: [] as FakeRow[],
      materials: [] as FakeRow[],
      material_pages: [] as FakeRow[],
      chapters: [] as FakeRow[],
      chunks: [] as FakeRow[],
      exercise_solutions: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    foreignKeys: {
      material_pages: { material_id: "materials" },
      chunks: { material_id: "materials" },
    },
    // The fake's Storage lets this user write their folder.
    userId: STUDENT,
    defaults: {
      ai_usage: () => ({ created_at: new Date().toISOString() }),
    },
    functions: {
      // supabase/migrations/…_create_set_chunk_embeddings.sql.
      set_chunk_embeddings: (args, tables) => {
        for (const { id, embedding } of args.p_embeddings as Array<{
          id: string;
          embedding: string;
        }>) {
          const chunk = tables.chunks.find((row) => row.id === id);
          if (chunk) chunk.embedding = embedding;
        }
        return null;
      },
      // supabase/migrations/…_create_replace_material_chunks.sql, one
      // transaction there; tested with pgTAP.
      replace_material_chunks: (args, tables) => {
        const material = tables.materials.find(
          (row) => row.id === args.p_material_id,
        );
        if (!material) return null;
        const owned = {
          owner: material.owner,
          course_id: material.course_id,
          material_id: material.id,
        };
        const chapters: FakeRow[] = (args.p_chapters as FakeRow[]).map(
          (chapter) => ({ id: crypto.randomUUID(), ...owned, ...chapter }),
        );
        const chapterAt = (position: unknown) =>
          chapters.find((chapter) => chapter.position === position)?.id ?? null;
        tables.chapters = [
          ...tables.chapters.filter(
            (chapter) => chapter.material_id !== material.id,
          ),
          ...chapters.map(({ parent_position, ...chapter }) => ({
            ...chapter,
            parent_id: chapterAt(parent_position),
          })),
        ];
        tables.chunks = [
          ...tables.chunks.filter((chunk) => chunk.material_id !== material.id),
          ...(args.p_chunks as FakeRow[]).map(
            ({ chapter_position, ...chunk }) => ({
              id: crypto.randomUUID(),
              ...owned,
              exercise_number: null,
              chapter_id: chapterAt(chapter_position),
              ...chunk,
            }),
          ),
        ];
        return null;
      },
      // supabase/migrations/…_create_exercise_solutions.sql; tested with
      // pgTAP.
      request_exercise_pairing: (args, tables) => {
        const course = tables.courses.find(
          (row) => row.id === args.p_course_id,
        );
        if (!course) return null;
        course.pairing_requested = Number(course.pairing_requested ?? 0) + 1;
        return course.pairing_requested;
      },
      replace_exercise_solutions: (args, tables) => {
        const course = tables.courses.find(
          (row) => row.id === args.p_course_id,
        );
        if (!course || course.pairing_requested !== args.p_request) {
          return false;
        }
        const inCourse = (id: unknown) =>
          tables.chunks.find(
            (chunk) => chunk.id === id && chunk.course_id === course.id,
          );
        tables.exercise_solutions = [
          ...tables.exercise_solutions.filter(
            (row) => row.course_id !== course.id,
          ),
          ...(args.p_pairs as FakeRow[])
            .filter((pair) => inCourse(pair.exercise_chunk_id))
            .map((pair) => {
              const solution = inCourse(pair.solution_chunk_id);
              return {
                id: crypto.randomUUID(),
                owner: course.owner,
                course_id: course.id,
                exercise_chunk_id: pair.exercise_chunk_id,
                solution_chunk_id: solution?.id ?? null,
                status: solution ? "paired" : "no_solution",
                candidates_hash: pair.candidates_hash ?? null,
              };
            }),
        ];
        return true;
      },
    },
  });
}

export type ParseDb = ReturnType<typeof createParseDb>;

/** The Student's Course, unless it is there already. */
export function seedCourse(db: ParseDb, id = COURSE) {
  if (db.tables.courses.some((course) => course.id === id)) return;
  db.tables.courses.push({
    id,
    owner: STUDENT,
    name: "Analysis",
    pairing_requested: 0,
  });
}

/**
 * What deleting a Material leaves in the tables: its rows are gone, with
 * the pairs of its chunks, as the foreign keys cascade.
 */
export function deleteMaterialRows(db: ParseDb, materialId: string) {
  const gone = new Set(
    db.tables.chunks
      .filter((chunk) => chunk.material_id === materialId)
      .map((chunk) => chunk.id),
  );
  db.tables.materials = db.tables.materials.filter(
    (material) => material.id !== materialId,
  );
  db.tables.material_pages = db.tables.material_pages.filter(
    (page) => page.material_id !== materialId,
  );
  db.tables.chapters = db.tables.chapters.filter(
    (chapter) => chapter.material_id !== materialId,
  );
  db.tables.chunks = db.tables.chunks.filter((chunk) => !gone.has(chunk.id));
  db.tables.exercise_solutions = db.tables.exercise_solutions.filter(
    (row) =>
      !gone.has(row.exercise_chunk_id as string) &&
      !gone.has(row.solution_chunk_id as string),
  );
}

/**
 * The Course's pairs, each as its exercise's and its solution's markdown,
 * sorted by the exercise's.
 */
export function storedPairs(db: ParseDb) {
  const markdown = (id: unknown) =>
    db.tables.chunks.find((chunk) => chunk.id === id)?.markdown;
  return db.tables.exercise_solutions
    .map((row) => ({
      exercise: markdown(row.exercise_chunk_id),
      solution: row.solution_chunk_id ? markdown(row.solution_chunk_id) : null,
      status: row.status,
    }))
    .toSorted((a, b) => String(a.exercise).localeCompare(String(b.exercise)));
}

/** A fixture file from `test-files/`. */
export const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "test-files", name));

/**
 * A `queued` Material of the Student in their Course, with its file in
 * Storage: `MATERIAL` unless the test gives another id.
 */
export function seedMaterial(
  db: ParseDb,
  mediaType: string,
  body: Uint8Array,
  { id = MATERIAL, name = "Lecture 1" }: { id?: string; name?: string } = {},
) {
  seedCourse(db);
  const storagePath = `${STUDENT}/${COURSE}/${id}`;
  db.tables.materials.push({
    id,
    owner: STUDENT,
    course_id: COURSE,
    name,
    media_type: mediaType,
    size_bytes: body.byteLength,
    storage_path: storagePath,
    parse_status: "queued",
    pages_total: null,
    pages_done: 0,
    heartbeat_at: new Date().toISOString(),
  });
  db.files.seed(BUCKET, storagePath, { body, contentType: mediaType });
}

/** A unit of a canned batch result, on page 1 unless it says otherwise. */
export const unit = (overrides: Record<string, unknown>) => ({
  markdown: "",
  label: "content",
  pageFrom: 1,
  pageTo: 1,
  style: null,
  continuesFromPreviousBatch: false,
  continuesOnNextBatch: false,
  ...overrides,
});

/** A canned batch result. */
type CannedBatch = { units: unknown };

type Prompt = Array<{ role: string; content: unknown }>;

/** Whether a call is a batch call: it carries page images. */
export const isPageCall = (prompt: unknown) =>
  (prompt as Prompt).some(
    (message) =>
      Array.isArray(message.content) &&
      (message.content as Array<{ type: string }>).some(
        (part) => part.type === "file",
      ),
  );

/** What a content-matching call of pairing offered, by id. */
export type SentPairing = {
  exercises: Array<{
    id: string;
    number: string | null;
    markdown: string;
    candidates: string[];
  }>;
  solutions: Array<{ id: string; number: string | null; markdown: string }>;
};

/** A content-matching call's answer: pairs of offered ids. */
export type CannedPairing = {
  pairs: Array<{ exerciseId: string; solutionId: string }>;
};

function promptText(prompt: unknown) {
  return (prompt as Prompt)
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content as Array<{ text?: string }>)
    .map((part) => part.text ?? "")
    .join("");
}

/** Whether a call is pairing's content-matching call. */
export const isPairingCall = (prompt: unknown) =>
  !isPageCall(prompt) && "exercises" in JSON.parse(promptText(prompt));

/** The exercises and solutions a content-matching call offered. */
export const sentPairing = (prompt: unknown) =>
  JSON.parse(promptText(prompt)) as SentPairing;

const usage = {
  inputTokens: {
    total: 1000,
    noCache: 1000,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 200, text: 200, reasoning: undefined },
};

/** A streamed answer of `text`, as a batch call reads it. */
export function streamedAnswer(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start" as const, id: "text-1" },
        { type: "text-delta" as const, id: "text-1", delta: text },
        { type: "text-end" as const, id: "text-1" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: undefined },
          usage,
        },
      ],
    }),
  };
}

/** A structure call's answer: an English Material without Chapters. */
export const NO_OUTLINE = { language: "English", notes: "", chapters: [] };

/** What a structure call was sent: the Material as JSON. */
export type SentOutline = {
  material: string;
  pages: number;
  pdfOutline?: Array<{ title: string; level: number; page: number }>;
  headings: Array<{ id: string; page: number; style: string; text: string }>;
  pageStarts: Array<{ page: number; text: string }>;
};

/**
 * The `ingest` model of a parse: answers each batch call (streamed; it
 * carries page images) with the next canned batch result, the structure
 * call (streamed, without images) with `outline` of what it was sent, and
 * pairing's content-matching call with `pairing` of what it offered, or no
 * pairs. Remembers what each kind of call was sent.
 */
export function pageModel(
  batches: CannedBatch[],
  pairing?: (sent: SentPairing) => CannedPairing | Promise<CannedPairing>,
  outline: (sent: SentOutline) => unknown = () => NO_OUTLINE,
) {
  const prompts: unknown[] = [];
  const outlinePrompts: SentOutline[] = [];
  const pairingPrompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      if (!isPageCall(prompt)) {
        const sent = JSON.parse(promptText(prompt)) as SentOutline;
        outlinePrompts.push(sent);
        return streamedAnswer(JSON.stringify(outline(sent)));
      }
      prompts.push(prompt);
      const answer = batches[prompts.length - 1] ?? { units: [] };
      return streamedAnswer(JSON.stringify(answer));
    },
    doGenerate: async ({ prompt }) => {
      pairingPrompts.push(prompt);
      const answer = pairing
        ? await pairing(sentPairing(prompt))
        : { pairs: [] };
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { model, prompts, outlinePrompts, pairingPrompts };
}

/** The image parts each page call sent, as media types. */
export function sentImages(prompts: unknown[]) {
  return prompts.map((prompt) =>
    (prompt as Prompt)
      .filter((message) => message.role === "user")
      .flatMap((message) => message.content as Array<{ type: string }>)
      .filter((part) => part.type === "file")
      .map((part) => (part as unknown as { mediaType: string }).mediaType),
  );
}

/** The stored chunks in reading order, with the columns tests compare. */
export function storedChunks(db: ParseDb) {
  return db.tables.chunks
    .toSorted((a, b) => Number(a.position) - Number(b.position))
    .map((chunk) => ({
      position: chunk.position,
      page_from: chunk.page_from,
      page_to: chunk.page_to,
      label: chunk.label,
      markdown: chunk.markdown,
    }));
}
