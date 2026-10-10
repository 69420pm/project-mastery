import "server-only";
import { randomUUID } from "node:crypto";
import { beforeEach, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the chat handler tests (`handler*.test.ts`), which are
 * split by behaviour. Importing this module mocks the signed-in user and the
 * Supabase server client with local tables, and resets both before each
 * test. Test files add `vi.mock("server-only", () => ({}))`.
 */

export const STUDENT = "11111111-1111-1111-1111-111111111111";
export const CLASSMATE = "22222222-2222-2222-2222-222222222222";
/** The Student's Course, and one of their classmate's. */
export const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
export const CLASSMATE_COURSE = "bbbbbbbb-c000-4000-8000-000000000001";
/** Another Course of the Student. */
export const OTHER_COURSE = "aaaaaaaa-c000-4000-8000-000000000002";

let signedIn: string | null = STUDENT;
/** The local tables of the current test. */
export let db = createDb();

/** Signs in as another user, or signs out with `null`. */
export function signInAs(user: string | null) {
  signedIn = user;
}

/** The local tables, with the ownership rules of the real policies. */
function createDb() {
  return fakeSupabase({
    tables: {
      courses: [
        { id: COURSE, owner: STUDENT, name: "Calculus" },
        { id: CLASSMATE_COURSE, owner: CLASSMATE, name: "Biology" },
        { id: OTHER_COURSE, owner: STUDENT, name: "Physics" },
      ] as FakeRow[],
      chats: [],
      chat_messages: [],
      ai_usage: [],
      materials: [],
    },
    // The Storage folder the Student may use.
    userId: STUDENT,
    defaults: {
      chats: () => ({
        owner: signedIn,
        title: null,
        title_set_manually: false,
        model_choice: "balanced",
      }),
      chat_messages: () => ({ model_id: null, stopped: false }),
      // Recorded now, as in the database, so it counts towards today's spend.
      ai_usage: () => ({
        owner: signedIn,
        estimated: false,
        chat_id: null,
        created_at: new Date().toISOString(),
      }),
    },
    canAccess: (table, row, tables) => {
      if (table === "chats") {
        return (
          row.owner === signedIn &&
          tables.courses.some(
            (course) =>
              course.id === row.course_id && course.owner === signedIn,
          )
        );
      }
      if (table === "courses" || table === "materials") {
        return row.owner === signedIn;
      }
      if (table === "ai_usage") {
        return (
          row.owner === signedIn &&
          (row.chat_id === null ||
            tables.chats.some(
              (chat) => chat.id === row.chat_id && chat.owner === signedIn,
            ))
        );
      }
      return tables.chats.some(
        (chat) => chat.id === row.chat_id && chat.owner === signedIn,
      );
    },
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

/**
 * Posts a request to the chat handler. The handler loads after the mocks
 * above. Aborting `signal` disconnects the client, as closing a tab does.
 */
export async function post(body: unknown, signal?: AbortSignal) {
  const { handleChatRequest } = await import("./handler");
  return handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  );
}

/** The text and error parts of a UI message stream, as the client sees them. */
function readStream(body: string) {
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return {
    text: chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join(""),
    error: chunks.find((chunk) => chunk.type === "error")?.errorText,
  };
}

/**
 * Sends a message and reads the whole response: the streamed reply, or the
 * refusal text.
 */
export async function send(body: unknown): Promise<{
  status: number;
  text?: string;
  error?: string;
  refusal?: string;
}> {
  const response = await post(body);
  const raw = await response.text();
  return response.ok
    ? { status: response.status, ...readStream(raw) }
    : { status: response.status, refusal: raw };
}

/** The stored messages of a Chat as role and text, in order. */
export function storedMessages(chatId: string) {
  return db.tables.chat_messages
    .filter((message) => message.chat_id === chatId)
    .map((message) => ({
      role: message.role,
      text: (message.parts as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
      modelId: message.model_id,
    }));
}

export function seedChat(owner: string, messages: FakeRow[] = []) {
  const chatId = randomUUID();
  db.tables.chats.push({
    id: chatId,
    owner,
    course_id: owner === STUDENT ? COURSE : CLASSMATE_COURSE,
    title: null,
    title_set_manually: false,
    model_choice: "balanced",
    created_at: "2025-12-31T00:00:00.000Z",
  });
  messages.forEach((message, index) =>
    db.tables.chat_messages.push({
      id: randomUUID(),
      chat_id: chatId,
      model_id: null,
      stopped: false,
      created_at: `2025-12-31T00:00:0${index}.000Z`,
      ...message,
    }),
  );
  return chatId;
}
