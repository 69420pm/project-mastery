// @vitest-environment node
// The chat handler: attached Materials.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import {
  STUDENT,
  CLASSMATE,
  COURSE,
  OTHER_COURSE,
  db,
  userMessage,
  send,
  storedMessages,
  seedChat,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

describe("attached Materials", () => {
  type MaterialRef = { id: string; name: string; mediaType: string };

  /**
   * A Material with its file in Storage. Its stored size is the file's,
   * unless `sizeBytes` says otherwise.
   */
  function seedMaterial({
    owner = STUDENT,
    courseId = COURSE,
    name,
    mediaType = "application/pdf",
    body = `%PDF ${name}`,
    sizeBytes,
  }: {
    owner?: string;
    courseId?: string;
    name: string;
    mediaType?: string;
    body?: string;
    sizeBytes?: number;
  }): MaterialRef {
    const id = randomUUID();
    const storagePath = `${owner}/${courseId}/${id}`;
    db.files.seed("course-files", storagePath, {
      body,
      contentType: mediaType,
    });
    db.tables.materials.push({
      id,
      owner,
      course_id: courseId,
      name,
      media_type: mediaType,
      size_bytes: sizeBytes ?? new TextEncoder().encode(body).byteLength,
      storage_path: storagePath,
    });
    return { id, name, mediaType };
  }

  /** A reference to a Material, as a Student message carries it. */
  function materialPart(material: MaterialRef) {
    return {
      type: "data-material",
      data: {
        materialId: material.id,
        name: material.name,
        mediaType: material.mediaType,
      },
    };
  }

  /** A Student message with optional text and attached Materials. */
  function messageWith(
    text: string,
    materials: MaterialRef[],
    id: string = randomUUID(),
  ) {
    return {
      id,
      role: "user",
      parts: [
        ...(text ? [{ type: "text", text }] : []),
        ...materials.map(materialPart),
      ],
    };
  }

  /**
   * The parts of the last user message in a model call, with file bytes as
   * text.
   */
  function receivedParts(model: MockLanguageModelV4, call = 0) {
    const prompt = model.doStreamCalls[call]?.prompt ?? [];
    const message = prompt.findLast(({ role }) => role === "user");
    return (
      (message?.content ?? []) as unknown as Array<Record<string, unknown>>
    ).map((part) =>
      part.type === "file"
        ? {
            type: "file",
            filename: part.filename,
            mediaType: part.mediaType,
            text: new TextDecoder().decode(
              (part.data as { data: Uint8Array }).data,
            ),
          }
        : { type: part.type, text: part.text },
    );
  }

  test("are sent to the model as files, under their current names", async () => {
    const model = mockTextModel("Let's look at it.");
    useMockModels({ chat: model });
    const lecture = seedMaterial({ name: "Lecture 3" });
    db.tables.materials[0]!.name = "Lecture 3: Eigenvalues";

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: messageWith("Explain this", [lecture]),
    });

    expect(reply.status).toBe(200);
    expect(receivedParts(model)).toEqual([
      { type: "text", text: "Explain this" },
      {
        type: "file",
        filename: "Lecture 3: Eigenvalues",
        mediaType: "application/pdf",
        text: "%PDF Lecture 3",
      },
    ]);
  });

  test("a message with only Materials is answered and stored as references", async () => {
    const model = mockTextModel("What would you like to know?");
    useMockModels({ chat: model });
    const sheet = seedMaterial({ name: "Sheet 1", mediaType: "image/png" });
    const chatId = randomUUID();

    const reply = await send({
      chatId,
      courseId: COURSE,
      message: messageWith("", [sheet]),
    });

    expect(reply.text).toBe("What would you like to know?");
    expect(receivedParts(model)).toEqual([
      {
        type: "file",
        filename: "Sheet 1",
        mediaType: "image/png",
        text: "%PDF Sheet 1",
      },
    ]);
    // Only the reference is stored, never the file.
    expect(db.tables.chat_messages[0]!.parts).toEqual([materialPart(sheet)]);
  });

  test("an empty message without Materials is refused", async () => {
    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: messageWith("  ", []),
    });

    expect(reply).toEqual({ status: 400, refusal: "Your message is empty." });
  });

  test("more than five Materials are refused", async () => {
    const materials = Array.from({ length: 6 }, (_, index) =>
      seedMaterial({ name: `Lecture ${index + 1}` }),
    );

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: messageWith("All of them", materials),
    });

    expect(reply).toEqual({
      status: 400,
      refusal: "Attach up to 5 materials to a message.",
    });
  });

  test.each([
    {
      case: "another Student's Material",
      seed: () => seedMaterial({ owner: CLASSMATE, name: "Notes" }),
      refusal: "An attached material does not exist.",
    },
    {
      case: "a Material from another of the Student's Courses",
      seed: () => seedMaterial({ courseId: OTHER_COURSE, name: "Optics" }),
      refusal: "An attached material belongs to another course.",
    },
    {
      case: "a missing Material",
      seed: () => ({
        id: randomUUID(),
        name: "Gone",
        mediaType: "application/pdf",
      }),
      refusal: "An attached material does not exist.",
    },
  ])(
    "$case is refused without a model call or a new Chat",
    async ({ seed, refusal }) => {
      const model = mockTextModel("Never sent.");
      useMockModels({ chat: model });

      const reply = await send({
        chatId: randomUUID(),
        courseId: COURSE,
        message: messageWith("Explain this", [seed()]),
      });

      expect(reply).toEqual({ status: 400, refusal });
      expect(model.doStreamCalls).toHaveLength(0);
      expect(db.tables.chats).toHaveLength(0);
    },
  );

  test("a new message to a stored Chat attaching a Material deleted in another tab is refused and not stored", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });
    const lecture = seedMaterial({ name: "Lecture 3" });
    const chatId = seedChat(STUDENT, [
      { role: "user", parts: [{ type: "text", text: "Hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "Hello." }] },
    ]);
    db.tables.materials = [];

    const reply = await send({
      chatId,
      message: messageWith("Explain this", [lecture]),
    });

    expect(reply).toEqual({
      status: 400,
      refusal: "An attached material does not exist.",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Hi",
      "Hello.",
    ]);
  });

  test("are sent again on later turns, and a deleted one as a note", async () => {
    const model = mockTextModel("Sure.");
    useMockModels({ chat: model });
    const lecture = seedMaterial({ name: "Lecture 3" });
    const removed = seedMaterial({ name: "Old exam" });
    const chatId = seedChat(STUDENT, [
      {
        role: "user",
        parts: [materialPart(lecture), materialPart(removed)],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: "What about them?" }],
      },
    ]);
    db.tables.materials = db.tables.materials.filter(
      (material) => material.id !== removed.id,
    );

    await send({ chatId, message: userMessage("Page 2, please") });

    const firstMessage = model.doStreamCalls[0]!.prompt[1]!;
    expect(firstMessage.role).toBe("user");
    expect(JSON.stringify(firstMessage.content)).toContain(
      '"filename":"Lecture 3"',
    );
    expect(JSON.stringify(firstMessage.content)).toContain(
      'The attached file \\"Old exam\\" was deleted.',
    );
    expect(JSON.stringify(firstMessage.content)).not.toContain(
      '"filename":"Old exam"',
    );
  });

  test("regenerating a reply reads the Materials again", async () => {
    const model = mockTextModel("Another look.");
    useMockModels({ chat: model });
    const lecture = seedMaterial({ name: "Lecture 3" });
    const message = messageWith("Explain this", [lecture]);
    const chatId = seedChat(STUDENT, [
      { id: message.id, role: "user", parts: message.parts },
      { role: "assistant", parts: [{ type: "text", text: "First look." }] },
    ]);

    await send({ chatId, message });

    expect(receivedParts(model)).toContainEqual({
      type: "file",
      filename: "Lecture 3",
      mediaType: "application/pdf",
      text: "%PDF Lecture 3",
    });
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Explain this",
      "Another look.",
    ]);
  });

  test("retrying a message whose Material was deleted since answers with the note", async () => {
    const model = mockTextModel("It is gone.");
    useMockModels({ chat: model });
    const lecture = seedMaterial({ name: "Lecture 3" });
    const message = messageWith("Explain this", [lecture]);
    const chatId = seedChat(STUDENT, [
      { id: message.id, role: "user", parts: message.parts },
    ]);
    db.tables.materials = [];

    const reply = await send({ chatId, message });

    expect(reply.status).toBe(200);
    expect(receivedParts(model)).toEqual([
      { type: "text", text: "Explain this" },
      { type: "text", text: '[The attached file "Lecture 3" was deleted.]' },
    ]);
  });

  test("resending a stored message's id with other Materials answers the stored message and stores nothing new", async () => {
    const model = mockTextModel("Here it is again.");
    useMockModels({ chat: model });
    const foreign = seedMaterial({ owner: CLASSMATE, name: "Their notes" });
    const otherCourse = seedMaterial({
      courseId: OTHER_COURSE,
      name: "Optics",
    });
    const messageId = randomUUID();
    const chatId = seedChat(STUDENT, [
      {
        id: messageId,
        role: "user",
        parts: [{ type: "text", text: "Explain this" }],
      },
      { role: "assistant", parts: [{ type: "text", text: "First look." }] },
    ]);

    const reply = await send({
      chatId,
      message: messageWith("Explain this", [foreign, otherCourse], messageId),
    });

    expect(reply.status).toBe(200);
    expect(receivedParts(model)).toEqual([
      { type: "text", text: "Explain this" },
    ]);
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toMatch(
      /Their notes|Optics/,
    );
    const student = db.tables.chat_messages.find(({ id }) => id === messageId);
    expect(student!.parts).toEqual([{ type: "text", text: "Explain this" }]);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Explain this",
      "Here it is again.",
    ]);
  });

  test("over 20 MB of Materials in one request are refused before any model call, keeping the message", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });
    const big = seedMaterial({ name: "Script", sizeBytes: 12 * 1024 * 1024 });
    const chatId = seedChat(STUDENT, [
      { role: "user", parts: [materialPart(big)] },
      { role: "assistant", parts: [{ type: "text", text: "Got it." }] },
    ]);

    const reply = await send({
      chatId,
      message: messageWith("And again", [big]),
    });

    expect(reply).toEqual({
      status: 413,
      refusal:
        "The materials in this chat are too large for the AI together. Start a new chat or attach fewer materials.",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "",
      "Got it.",
      "And again",
    ]);
  });

  test("exactly 20 MB of Materials are sent", async () => {
    const model = mockTextModel("Fine.");
    useMockModels({ chat: model });
    const big = seedMaterial({ name: "Script", sizeBytes: 20 * 1024 * 1024 });

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: messageWith("", [big]),
    });

    expect(reply.status).toBe(200);
  });

  test("a failed reply's estimated cost counts the Materials sent", async () => {
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("Model unavailable");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // About 20 pages, at about 260 tokens each.
    const script = seedMaterial({ name: "Script", sizeBytes: 1_000_000 });

    await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: messageWith("", [script]),
    });

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({ estimated: true }),
    ]);
    expect(db.tables.ai_usage[0]!.input_tokens).toBeGreaterThan(20 * 260);
  });

  test("a failed Storage read refuses with 503 and keeps the message for Retry", async () => {
    const model = mockTextModel("Read it now.");
    useMockModels({ chat: model });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lecture = seedMaterial({ name: "Lecture 3" });
    const message = messageWith("Explain this", [lecture]);
    const chatId = randomUUID();
    db.files.fail("download");

    const failed = await send({ chatId, courseId: COURSE, message });

    expect(failed).toEqual({
      status: 503,
      refusal: "Your materials could not be loaded. Please try again.",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Explain this",
    ]);

    db.files.heal();
    const retried = await send({ chatId, message });

    expect(retried.text).toBe("Read it now.");
  });
});
