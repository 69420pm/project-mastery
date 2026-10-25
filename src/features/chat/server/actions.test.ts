// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  chatNotFoundMessage,
  sourceNotFoundMessage,
} from "@/features/chat/schemas";
import {
  CLASSMATE,
  CLASSMATE_COURSE,
  COURSE,
  OTHER_COURSE,
  STUDENT,
  db,
  seedChat,
  signInAs,
} from "./handler-testing";

/**
 * The Chat's "…" menu actions on the Student's session client, with the
 * ownership rules of the real policies (handler-testing.ts).
 */

const revalidatePath = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect ${path}`);
  },
}));

const { deleteChat, getChatTitle, openSource, renameChat } =
  await import("./actions");

const chatNotFound = { ok: false, message: chatNotFoundMessage };
const signedOut = { ok: false, message: "Sign in again to continue." };

beforeEach(() => revalidatePath.mockReset());

describe("renameChat", () => {
  test("sets the title for good and refreshes the sidebar", async () => {
    const chatId = seedChat(STUDENT);

    const result = await renameChat({ chatId, title: "  Limits  " });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.chats[0]).toMatchObject({
      title: "Limits",
      title_set_manually: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  test.each([
    ["an empty title", "   "],
    ["a 101-character title", "x".repeat(101)],
  ])("refuses %s", async (_, title) => {
    const chatId = seedChat(STUDENT);

    const result = await renameChat({ chatId, title });

    expect(result.ok).toBe(false);
    expect(db.tables.chats[0]).toMatchObject({
      title: null,
      title_set_manually: false,
    });
  });

  test("accepts a 100-character title", async () => {
    const chatId = seedChat(STUDENT);
    const title = "x".repeat(100);

    expect(await renameChat({ chatId, title })).toMatchObject({ ok: true });
    expect(db.tables.chats[0]).toMatchObject({ title });
  });
});

describe("each action", () => {
  const actions = [
    ["renameChat", (chatId: string) => renameChat({ chatId, title: "New" })],
    ["getChatTitle", (chatId: string) => getChatTitle({ chatId })],
    ["deleteChat", (chatId: string) => deleteChat({ chatId, leave: true })],
  ] as const;

  test.each(actions)("%s refuses a signed-out Student", async (_, act) => {
    const chatId = seedChat(STUDENT);
    signInAs(null);

    expect(await act(chatId)).toEqual(signedOut);
    expect(db.tables.chats).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each(actions)(
    "%s gives not found for an unknown Chat or another Student's",
    async (_, act) => {
      const theirs = seedChat(CLASSMATE);

      expect(await act(randomUUID())).toEqual(chatNotFound);
      expect(await act(theirs)).toEqual(chatNotFound);
      expect(db.tables.chats[0]).toMatchObject({ id: theirs, title: null });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each(actions)("%s refuses a malformed id", async (_, act) => {
    expect(await act("not-a-uuid")).toMatchObject({ ok: false });
  });
});

test("getChatTitle gives the title, null while the Chat has none", async () => {
  const chatId = seedChat(STUDENT);
  expect(await getChatTitle({ chatId })).toEqual({ ok: true, data: null });

  await renameChat({ chatId, title: "Limits" });
  expect(await getChatTitle({ chatId })).toEqual({ ok: true, data: "Limits" });
});

describe("openSource", () => {
  /** A Material with one chunk and one Reading section in `course`. */
  function seedSource(owner: string, course: string) {
    const ids = { material: randomUUID(), chunk: randomUUID() };
    const section = randomUUID();
    db.tables.materials.push({
      id: ids.material,
      owner,
      course_id: course,
      name: "Lecture 7",
    });
    db.tables.chunks.push({
      id: ids.chunk,
      owner,
      course_id: course,
      material_id: ids.material,
      page_from: 4,
      page_to: 5,
    });
    db.tables.reading_sections.push({
      id: section,
      owner,
      course_id: course,
      material_id: ids.material,
      page_from: 12,
      page_to: 14,
      chunk_ids: [ids.chunk],
      mode: "study_text",
      reason: "Dense.",
      annotations: null,
      study_text: "Thrust is $F$.",
    });
    return { ...ids, section };
  }

  test("gives a cited chunk's Material at the chunk's pages", async () => {
    const { material, chunk } = seedSource(STUDENT, COURSE);

    expect(
      await openSource({ courseId: COURSE, kind: "chunk", id: chunk }),
    ).toEqual({
      ok: true,
      data: {
        materialId: material,
        materialName: "Lecture 7",
        pageFrom: 4,
        pageTo: 5,
        reading: null,
      },
    });
  });

  test("gives a Reading section with its mode and texts", async () => {
    const { material, section } = seedSource(STUDENT, COURSE);

    expect(
      await openSource({ courseId: COURSE, kind: "section", id: section }),
    ).toEqual({
      ok: true,
      data: {
        materialId: material,
        materialName: "Lecture 7",
        pageFrom: 12,
        pageTo: 14,
        reading: {
          mode: "study_text",
          annotations: null,
          studyText: "Thrust is $F$.",
        },
      },
    });
  });

  test.each([
    ["another Course of the Student", STUDENT, OTHER_COURSE],
    ["a classmate's Course", CLASSMATE, CLASSMATE_COURSE],
  ])("does not find a source of %s", async (_, owner, course) => {
    const { chunk, section } = seedSource(owner, course);
    const notFound = { ok: false, message: sourceNotFoundMessage };

    for (const [kind, id] of [
      ["chunk", chunk],
      ["section", section],
      ["chunk", "not-a-uuid"],
    ] as const) {
      expect(await openSource({ courseId: COURSE, kind, id })).toEqual(
        notFound,
      );
    }
  });
});

describe("deleteChat", () => {
  test("deletes the Chat and refreshes the sidebar", async () => {
    const chatId = seedChat(STUDENT);

    expect(await deleteChat({ chatId })).toEqual({ ok: true, data: undefined });
    expect(db.tables.chats).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  test("with leave, lands the Student on a new Chat in its Course", async () => {
    const chatId = seedChat(STUDENT);

    await expect(deleteChat({ chatId, leave: true })).rejects.toThrow(
      `redirect /courses/${COURSE}/chat`,
    );
    expect(db.tables.chats).toEqual([]);
  });
});
