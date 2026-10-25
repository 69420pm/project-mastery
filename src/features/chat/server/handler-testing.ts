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

/**
 * The tables of a Course's Knowledge map, Priorities, Brief and chunks,
 * which the tutor context reads. Visible to the Course's owner.
 */
const COURSE_TABLES = [
  "big_ideas",
  "kcs",
  "kc_sources",
  "prerequisite_links",
  "semantic_links",
  "exercises",
  "exercise_kcs",
  "exercise_solutions",
  "findings",
  "finding_sources",
  "knowledge_map_builds",
  "kc_priorities",
  "briefs",
  "chunks",
  "memories",
  "topics",
  "reading_sections",
  "map_findings",
] as const;

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
      big_ideas: [],
      kcs: [],
      kc_sources: [],
      prerequisite_links: [],
      semantic_links: [],
      exercises: [],
      exercise_kcs: [],
      exercise_solutions: [],
      findings: [],
      finding_sources: [],
      knowledge_map_builds: [],
      kc_priorities: [],
      briefs: [],
      chunks: [],
      study_sessions: [],
      questions: [],
      question_kcs: [],
      attempts: [],
      memories: [],
      topics: [],
      topic_kcs: [],
      topic_choices: [],
      reading_sections: [],
      map_findings: [],
    },
    primaryKeys: { memories: ["course_id"] },
    foreignKeys: {
      chunks: { material_id: "materials" },
      reading_sections: { material_id: "materials" },
      topic_kcs: { topic_id: "topics" },
      topic_choices: { topic_id: "topics" },
      questions: { session_id: "study_sessions" },
      question_kcs: { question_id: "questions" },
      attempts: { question_id: "questions", session_id: "study_sessions" },
    },
    // Every new Chat starts a learn session in its Course.
    afterInsert: {
      chats: (chat, tables) => {
        tables.study_sessions.push({
          id: randomUUID(),
          owner: chat.owner,
          chat_id: chat.id,
          course_id: chat.course_id,
          mode: "learn",
          topic_id: null,
          stage: null,
          started_at: new Date().toISOString(),
          ended_at: null,
        });
      },
    },
    functions: {
      // As the real functions: on the Student's own running session only.
      start_study_session_topic: (args, tables) => {
        const session = tables.study_sessions.find(
          (row) => row.id === args.p_session_id && row.owner === signedIn,
        );
        const topic = tables.topics.find(({ id }) => id === args.p_topic_id);
        if (
          !session ||
          session.topic_id !== null ||
          session.ended_at !== null ||
          topic?.course_id !== session.course_id
        ) {
          return false;
        }
        Object.assign(session, {
          topic_id: args.p_topic_id,
          stage: args.p_stage,
        });
        return true;
      },
      set_study_session_stage: (args, tables) => {
        const session = tables.study_sessions.find(
          (row) => row.id === args.p_session_id && row.owner === signedIn,
        );
        if (
          !session ||
          session.topic_id === null ||
          session.ended_at !== null ||
          session.stage === "close"
        ) {
          return false;
        }
        session.stage = args.p_stage;
        return true;
      },
      // The real function appends as the Student; this one trusts the Course.
      append_memory: (args, tables) => {
        const line = `${new Date().toISOString().slice(0, 10)}: ${args.text}`;
        const memory = tables.memories.find(
          (row) => row.course_id === args.course_id,
        );
        const text = memory?.text ? `${memory.text}\n${line}` : line;
        if (text.length > 4000) return false;
        if (memory) memory.text = text;
        else {
          tables.memories.push({
            course_id: args.course_id,
            owner: signedIn,
            text,
          });
        }
        return true;
      },
    },
    // The Storage folder the Student may use.
    userId: STUDENT,
    defaults: {
      chats: () => ({
        owner: signedIn,
        title: null,
        title_set_manually: false,
      }),
      chat_messages: () => ({ model_id: null, stopped: false }),
      map_findings: () => ({ owner: signedIn, status: "open", outcome: null }),
      questions: () => ({
        owner: signedIn,
        asked_at: new Date().toISOString(),
        answer_text: null,
        answer_message_id: null,
        answered_at: null,
        graded_at: null,
      }),
      // Recorded now, as in the database, so the FSRS replay reads it today.
      attempts: () => ({
        owner: signedIn,
        check: null,
        created_at: new Date().toISOString(),
      }),
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
      if (
        table === "courses" ||
        table === "materials" ||
        table === "study_sessions" ||
        table === "questions" ||
        table === "attempts"
      ) {
        return row.owner === signedIn;
      }
      if (table === "question_kcs") {
        return tables.questions.some(
          (question) =>
            question.id === row.question_id && question.owner === signedIn,
        );
      }
      if (table === "topic_kcs" || table === "topic_choices") {
        return tables.topics.some(
          (topic) =>
            topic.id === row.topic_id &&
            tables.courses.some(
              (course) =>
                course.id === topic.course_id && course.owner === signedIn,
            ),
        );
      }
      if ((COURSE_TABLES as readonly string[]).includes(table)) {
        return tables.courses.some(
          (course) => course.id === row.course_id && course.owner === signedIn,
        );
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
    startMetadata: chunks.find((chunk) => chunk.type === "start")
      ?.messageMetadata,
    finishMetadata: chunks.find((chunk) => chunk.type === "finish")
      ?.messageMetadata,
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
  /** The metadata on the reply's `start` part. */
  startMetadata?: Record<string, unknown>;
  /** The metadata on the reply's `finish` part. */
  finishMetadata?: Record<string, unknown>;
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

/** The ids of the map `seedMap` stores in the Student's Course. */
export const MAP = {
  bigIdea: "aaaaaaaa-b000-4000-8000-000000000001",
  /** Prior knowledge: Newton's second law. */
  prior: "aaaaaaaa-0000-4000-8000-000000000001",
  /** Thrust, taught by `chunks[0]` and `chunks[1]`, Priority 0.8. */
  thrust: "aaaaaaaa-0000-4000-8000-000000000002",
  /** Propulsive efficiency, which needs thrust first. */
  efficiency: "aaaaaaaa-0000-4000-8000-000000000003",
  /** The one Topic, holding thrust then efficiency. */
  topic: "aaaaaaaa-7000-4000-8000-000000000001",
  material: "aaaaaaaa-a000-4000-8000-000000000001",
  chunks: [
    "aaaaaaaa-c400-4000-8000-000000000001",
    "aaaaaaaa-c400-4000-8000-000000000002",
  ],
} as const;

/** Stores a small built Knowledge map with Priorities in the Student's Course. */
export function seedMap() {
  const owned = { owner: STUDENT, course_id: COURSE };
  const kc = (
    id: string,
    position: number,
    name: string,
    type: string,
    bigIdea: string | null,
  ) => ({
    ...owned,
    id,
    position,
    name,
    description: `${name}, as the lecture states it.`,
    type,
    big_idea_id: bigIdea,
    bloom: bigIdea ? "apply" : null,
    origin: bigIdea ? "content" : "prior",
  });
  db.tables.big_ideas.push({
    ...owned,
    id: MAP.bigIdea,
    position: 0,
    name: "Thrust generation",
    description: "How engines make thrust.",
  });
  db.tables.kcs.push(
    kc(MAP.prior, 0, "Newton's second law", "prior", null),
    kc(MAP.thrust, 1, "Thrust equation", "procedure", MAP.bigIdea),
    kc(MAP.efficiency, 2, "Propulsive efficiency", "concept", MAP.bigIdea),
  );
  db.tables.prerequisite_links.push(
    ...[
      { ...owned, id: 1, from_kc: MAP.prior, to_kc: MAP.thrust },
      { ...owned, id: 2, from_kc: MAP.thrust, to_kc: MAP.efficiency },
    ].map((link) => ({ ...link, extraction_confidence: 1 })),
  );
  db.tables.topics.push({
    course_id: COURSE,
    id: MAP.topic,
    big_idea_id: MAP.bigIdea,
    position: 0,
    name: "Thrust",
    central_question: "How does an engine make thrust?",
    why_it_matters: "Every engine question starts here.",
  });
  db.tables.topic_kcs.push(
    { topic_id: MAP.topic, kc_id: MAP.thrust, position: 0 },
    { topic_id: MAP.topic, kc_id: MAP.efficiency, position: 1 },
  );
  db.tables.kc_priorities.push({
    ...owned,
    kc_id: MAP.thrust,
    priority: 0.8,
    multiplier: 1,
    reasons: [],
  });
  db.tables.materials.push({
    ...owned,
    id: MAP.material,
    name: "Lecture 7",
    created_at: "2025-12-01T00:00:00.000Z",
  });
  MAP.chunks.forEach((id, position) => {
    db.tables.chunks.push({
      ...owned,
      id,
      material_id: MAP.material,
      position,
      page_from: 3 + position,
      page_to: 3 + position * 2,
      markdown: `Chunk ${position}: $F = \\dot m (v_e - v_0)$`,
    });
    db.tables.kc_sources.push({ ...owned, kc_id: MAP.thrust, chunk_id: id });
  });
}
