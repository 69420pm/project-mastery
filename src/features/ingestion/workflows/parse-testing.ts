import { readFile } from "node:fs/promises";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the parse workflow in-process (`parse-material.ts`): the
 * admin client as a `fakeSupabase`, a seeded Material, and an `ingest` model
 * with canned page and file results. Each test file mocks
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
export const BUCKET = "course-files";

/** The admin client a workflow has: no session, no Row Level Security. */
export function createParseDb() {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      material_pages: [] as FakeRow[],
      chunks: [] as FakeRow[],
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
      // supabase/migrations/…_create_replace_material_chunks.sql, one
      // transaction there; tested with pgTAP.
      replace_material_chunks: (args, tables) => {
        const material = tables.materials.find(
          (row) => row.id === args.p_material_id,
        );
        if (!material) return null;
        tables.chunks = [
          ...tables.chunks.filter(
            (chunk) => chunk.material_id !== args.p_material_id,
          ),
          ...(args.p_chunks as FakeRow[]).map((chunk) => ({
            id: crypto.randomUUID(),
            owner: material.owner,
            course_id: material.course_id,
            material_id: material.id,
            ...chunk,
          })),
        ];
        Object.assign(material, {
          is_exam: args.p_is_exam,
          exam_year: args.p_is_exam ? (args.p_exam_year ?? null) : null,
          exam_total_points: args.p_is_exam
            ? (args.p_exam_total_points ?? null)
            : null,
        });
        return null;
      },
    },
  });
}

export type ParseDb = ReturnType<typeof createParseDb>;

/** A fixture file from `test-files/`. */
export const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "test-files", name));

/** A `queued` Material of the Student, with its file in Storage. */
export function seedMaterial(db: ParseDb, mediaType: string, body: Uint8Array) {
  db.tables.materials.push({
    id: MATERIAL,
    owner: STUDENT,
    course_id: COURSE,
    name: "Lecture 1",
    media_type: mediaType,
    size_bytes: body.byteLength,
    storage_path: STORAGE_PATH,
    parse_status: "queued",
    pages_total: null,
    pages_done: 0,
  });
  db.files.seed(BUCKET, STORAGE_PATH, { body, contentType: mediaType });
}

/** A unit of a canned page result. */
export const unit = (overrides: Record<string, unknown>) => ({
  markdown: "",
  label: "content",
  exerciseNumber: null,
  points: null,
  figure: null,
  continuesFromPreviousPage: false,
  continuesOnNextPage: false,
  ...overrides,
});

type CannedPage = { units: Array<Record<string, unknown>> };

export type CannedFileResult = {
  chunks: Array<{
    unitIds: string[];
    label: string;
    exerciseNumber: string | null;
    points: number | null;
  }>;
  exam: {
    isOldExam: boolean;
    year: number | null;
    totalPoints: number | null;
  } | null;
};

/**
 * A file call's answer when a test gives none: one chunk per unit the call
 * offered, with the unit's own label, number and points.
 */
export function answerFileCall(filePrompt: unknown): CannedFileResult {
  return {
    chunks: sentUnits(filePrompt).map((offered) => ({
      unitIds: [String(offered.id)],
      label: String(offered.label),
      exerciseNumber: (offered.exerciseNumber as string | null) ?? null,
      points: (offered.points as number | null) ?? null,
    })),
    exam: null,
  };
}

type Prompt = Array<{ role: string; content: unknown }>;

/** Whether a call is a page call: it carries the page image. */
export const isPageCall = (prompt: unknown) =>
  (prompt as Prompt).some(
    (message) =>
      Array.isArray(message.content) &&
      (message.content as Array<{ type: string }>).some(
        (part) => part.type === "file",
      ),
  );

/**
 * The `ingest` model of a parse: answers each page call (it carries the page
 * image) with the next canned page result, and the file call with `file`,
 * or one chunk per offered unit. Remembers what each kind of call was sent.
 */
export function pageModel(pages: CannedPage[], file?: CannedFileResult) {
  const prompts: unknown[] = [];
  const filePrompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      let answer: unknown;
      if (isPageCall(prompt)) {
        prompts.push(prompt);
        answer = pages[prompts.length - 1] ?? { units: [] };
      } else {
        filePrompts.push(prompt);
        answer = file ?? answerFileCall(prompt);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 1000,
            noCache: 1000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts, filePrompts };
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

/** The units a file call offered, parsed from its text. */
export function sentUnits(filePrompt: unknown) {
  const text = (filePrompt as Prompt)
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content as Array<{ text?: string }>)
    .map((part) => part.text ?? "")
    .join("");
  return (JSON.parse(text) as { units: Array<Record<string, unknown>> }).units;
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
      exercise_number: chunk.exercise_number,
      points: chunk.points,
    }));
}
