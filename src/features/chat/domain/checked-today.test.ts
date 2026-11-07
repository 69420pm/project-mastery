import { expect, test } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import type { TutorContext } from "@/features/study";
import { checkedToday, checkedTodayText } from "./checked-today";

const context = (ids: string[]) =>
  ({
    session: {
      checkedToday: ids.map((id) => ({
        id,
        name: id,
        result: "full",
        help: "none",
      })),
    },
  }) as unknown as TutorContext;

const reply = (ids: string[], graded: string[] = []) =>
  ({
    id: "r",
    role: "assistant",
    metadata: { tutorContext: context(ids) },
    parts: [
      {
        type: "tool-grade",
        toolCallId: "g",
        state: "output-available",
        input: {},
        output: { kcs: graded.map((id) => ({ id })), check: null },
      },
    ],
  }) as ChatUIMessage;

test("counts the newest context's KCs and those its reply graded, each once", () => {
  expect(checkedToday([reply(["a"]), reply(["a", "b", "a"], ["b", "c"])])).toBe(
    3,
  );
});

test("is null before a reply with a context", () => {
  expect(
    checkedToday([{ id: "s", role: "user", parts: [] } as ChatUIMessage]),
  ).toBeNull();
});

test("names the count", () => {
  expect(checkedTodayText(1)).toBe("Checked today: 1 KC");
  expect(checkedTodayText(4)).toBe("Checked today: 4 KCs");
});
