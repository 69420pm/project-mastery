// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { chatNotFoundMessage } from "@/features/chat/schemas";
import {
  CLASSMATE,
  COURSE,
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

const { deleteChat, getChatTitle, renameChat } = await import("./actions");

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
