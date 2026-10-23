// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * The Chat page's and the sidebar's reads on the Student's session client.
 * Row Level Security is emulated per owner; pgTAP tests the real policies.
 */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const OTHER_COURSE = "aaaaaaaa-c000-4000-8000-000000000002";
const chatIds = [
  "cccccccc-0000-4000-8000-000000000001",
  "cccccccc-0000-4000-8000-000000000002",
  "cccccccc-0000-4000-8000-000000000003",
  "cccccccc-0000-4000-8000-000000000004",
] as const;

let signedIn = true;
let db = createDb();

function createDb() {
  return fakeSupabase({
    tables: {
      chats: [] as FakeRow[],
      chat_messages: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
      study_sessions: [] as FakeRow[],
      questions: [] as FakeRow[],
    },
    foreignKeys: {
      chat_messages: { chat_id: "chats" },
      questions: { session_id: "study_sessions" },
    },
    canAccess: (table, row, tables) =>
      table === "chats"
        ? row.owner === STUDENT
        : tables.chats.some(
            (chat) => chat.id === row.chat_id && chat.owner === STUDENT,
          ),
  });
}

function seedChat(
  id: string,
  {
    course = COURSE,
    owner = STUDENT,
    title = null,
    lastMessageAt,
    messages = [],
  }: {
    course?: string;
    owner?: string;
    title?: string | null;
    lastMessageAt: string;
    messages?: string[];
  },
) {
  db.tables.chats.push({
    id,
    owner,
    course_id: course,
    title,
    model_choice: "balanced",
    last_message_at: lastMessageAt,
  });
  messages.forEach((text, index) =>
    db.tables.chat_messages.push({
      id: randomUUID(),
      chat_id: id,
      role: index % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text }],
      model_id: null,
      stopped: false,
      tutor_context: null,
      created_at: `2026-01-01T00:00:0${index}.000Z`,
    }),
  );
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: STUDENT } : null),
  requireUser: async () => ({ id: STUDENT }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { getChat, getChatList } = await import("./queries");

beforeEach(() => {
  signedIn = true;
  db = createDb();
  // The offered model choices read the AI settings.
  vi.stubEnv("AI_PROVIDER", "gateway");
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
});

describe("getChat", () => {
  test("gives the Chat with its messages in order", async () => {
    seedChat(chatIds[0], {
      lastMessageAt: "2026-01-02",
      messages: ["What is a limit?", "What do you think?"],
    });

    const chat = await getChat(COURSE, chatIds[0]);

    expect(chat).toMatchObject({ id: chatIds[0], courseId: COURSE });
    expect(chat?.messages.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  test.each([
    ["a non-uuid id", COURSE, "not-a-uuid"],
    ["a Chat of another Course", OTHER_COURSE, chatIds[0]],
    ["an unknown Chat", COURSE, chatIds[1]],
  ])("is null for %s", async (_, courseId, chatId) => {
    seedChat(chatIds[0], { lastMessageAt: "2026-01-02" });
    expect(await getChat(courseId, chatId)).toBeNull();
  });
});

describe("getChatList", () => {
  test("lists only the Course's own Chats, newest message first, with labels", async () => {
    seedChat(chatIds[0], {
      lastMessageAt: "2026-01-01",
      messages: ["What is a limit?", "Tell me first."],
    });
    seedChat(chatIds[1], { lastMessageAt: "2026-01-03", title: "Derivatives" });
    seedChat(chatIds[2], { lastMessageAt: "2026-01-02" });
    seedChat(chatIds[3], { lastMessageAt: "2026-01-04", course: OTHER_COURSE });
    db.tables.chats.push({
      id: "cccccccc-0000-4000-8000-000000000009",
      owner: "someone else",
      course_id: COURSE,
      title: "Not mine",
      last_message_at: "2026-01-05",
    });

    expect(await getChatList(COURSE)).toEqual([
      { id: chatIds[1], label: "Derivatives" },
      { id: chatIds[2], label: "New chat" },
      { id: chatIds[0], label: "What is a limit?" },
    ]);
  });

  test.each([
    ["signed out", COURSE, false],
    ["a non-uuid Course id", "not-a-uuid", true],
  ])("is empty when %s", async (_, courseId, user) => {
    seedChat(chatIds[0], { lastMessageAt: "2026-01-01", title: "Limits" });
    signedIn = user;
    expect(await getChatList(courseId)).toEqual([]);
  });
});
