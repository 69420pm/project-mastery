import "server-only";
import { randomUUID } from "node:crypto";
import { beforeEach, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the Brief handler tests (`handler*.test.ts`), which are
 * split by behaviour. Importing this module mocks the signed-in user and the
 * Supabase server client with local tables, and resets both before each
 * test. Test files add `vi.mock("server-only", () => ({}))`.
 */

export const STUDENT = "11111111-1111-1111-1111-111111111111";
export const CLASSMATE = "22222222-2222-2222-2222-222222222222";
export const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
export const CLASSMATE_COURSE = "bbbbbbbb-c000-4000-8000-000000000001";
export const OLD_EXAM = "aaaaaaaa-0000-4000-8000-00000000e024";
export const LECTURE = "aaaaaaaa-0000-4000-8000-000000000001";

/** The Student's open Findings, in map order, and one of their classmate's. */
export const MISMATCH = "aaaaaaaa-f000-4000-8000-000000000001";
export const SCOPE = "aaaaaaaa-f000-4000-8000-000000000002";
export const CLASSMATE_FINDING = "bbbbbbbb-f000-4000-8000-000000000001";
/** The source of MISMATCH, on page 3 of Lecture 1. */
const CHUNK = "aaaaaaaa-0c00-4000-8000-000000000001";

/** An open Finding, never asked. */
function finding(id: string, owner: string, position: number, kind: string) {
  return {
    id,
    owner,
    course_id: owner === STUDENT ? COURSE : CLASSMATE_COURSE,
    kind,
    position,
    text: `Finding ${position} of ${kind}.`,
    status: "open",
    answer: null,
    asked_at: null,
    answered_at: null,
  };
}

let signedIn: string | null = STUDENT;
/** The local tables of the current test. */
export let db = createDb();

/** Signs in as another user, or signs out with `null`. */
export function signInAs(user: string | null) {
  signedIn = user;
}

function ownBrief(briefs: FakeRow[], courseId: unknown) {
  return briefs.find(
    (brief) => brief.course_id === courseId && brief.owner === signedIn,
  );
}

/** The local tables, with the ownership rules of the real policies. */
function createDb() {
  return fakeSupabase({
    tables: {
      courses: [
        { id: COURSE, owner: STUDENT, name: "Calculus" },
        { id: CLASSMATE_COURSE, owner: CLASSMATE, name: "Biology" },
      ] as FakeRow[],
      materials: [
        {
          id: OLD_EXAM,
          owner: STUDENT,
          course_id: COURSE,
          name: "Old exam 2024",
          created_at: "2026-10-01T00:00:00Z",
        },
        {
          id: LECTURE,
          owner: STUDENT,
          course_id: COURSE,
          name: "Lecture 1",
          created_at: "2026-10-02T00:00:00Z",
        },
      ] as FakeRow[],
      briefs: [],
      brief_excluded_materials: [],
      brief_messages: [],
      ai_usage: [],
      findings: [
        finding(MISMATCH, STUDENT, 0, "solution_mismatch"),
        finding(SCOPE, STUDENT, 1, "scope"),
        finding(CLASSMATE_FINDING, CLASSMATE, 0, "scope"),
      ],
      finding_sources: [
        {
          finding_id: MISMATCH,
          chunk_id: CHUNK,
          course_id: COURSE,
          owner: STUDENT,
        },
      ] as FakeRow[],
      chunks: [
        {
          id: CHUNK,
          owner: STUDENT,
          material_id: LECTURE,
          page_from: 3,
          position: 0,
        },
      ] as FakeRow[],
    },
    primaryKeys: {
      briefs: ["course_id"],
      brief_excluded_materials: ["course_id", "material_id"],
    },
    // What the handler needs of the real functions; pgTAP tests those.
    functions: {
      save_brief: (args, tables) => {
        const brief = ownBrief(tables.briefs, args.course_id);
        if (!brief) return false;
        Object.assign(brief, args.fields);
        const ids = args.excluded_material_ids as string[] | undefined;
        if (ids) {
          tables.brief_excluded_materials = tables.brief_excluded_materials
            .filter((row) => row.course_id !== args.course_id)
            .concat(
              [...new Set(ids)].map((id) => ({
                course_id: args.course_id,
                material_id: id,
                owner: signedIn,
              })),
            );
        }
        return true;
      },
      add_brief_note: (args, tables) => {
        const brief = ownBrief(tables.briefs, args.course_id);
        if (!brief) return null;
        const notes = brief.notes
          ? `${brief.notes}\n\n${args.text}`
          : (args.text as string);
        if (notes.length > 20_000) return false;
        brief.notes = notes;
        return true;
      },
    },
    defaults: {
      briefs: () => ({
        owner: signedIn,
        exam_date: null,
        goal: null,
        hours_per_week: null,
        question_style: null,
        open_book: null,
        formula_sheet: null,
        calculator: null,
        scope_confirmed: false,
        notes: null,
      }),
      brief_excluded_materials: () => ({ owner: signedIn }),
      brief_messages: () => ({ owner: signedIn, model_id: null }),
      ai_usage: () => ({
        owner: signedIn,
        estimated: false,
        chat_id: null,
        created_at: new Date().toISOString(),
      }),
    },
    canAccess: (table, row, tables) =>
      row.owner === signedIn &&
      (table === "briefs"
        ? tables.courses.some(
            (course) =>
              course.id === row.course_id && course.owner === signedIn,
          )
        : table !== "brief_messages" ||
          tables.briefs.some(
            (brief) =>
              brief.course_id === row.course_id && brief.owner === signedIn,
          )),
  });
}

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
  vi.stubEnv("AI_DAILY_LIMIT_USD", "");
});

export function userMessage(text: string, id: string = randomUUID()) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

/** Posts a request to the Brief handler and reads the whole response. */
export async function send(body: unknown) {
  const { handleBriefRequest } = await import("./handler");
  const response = await handleBriefRequest(
    new Request("http://localhost/api/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const raw = await response.text();
  if (!response.ok) return { status: response.status, refusal: raw };
  const text = raw
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)))
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
  return { status: response.status, text };
}

/** The stored messages of a Course's Brief as role and text, in order. */
export function stored(courseId = COURSE) {
  return db.tables.brief_messages
    .filter((message) => message.course_id === courseId)
    .map((message) => ({
      role: message.role,
      text: (message.parts as Array<{ text?: string }>)
        .map((part) => part.text ?? "")
        .join(""),
    }));
}
