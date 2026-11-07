import { expect, test } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import { modelHistory } from "./model-history";

const student = (id: string, ...parts: ChatUIMessage["parts"]) =>
  ({ id, role: "user", parts }) as ChatUIMessage;
const text = (value: string) => ({ type: "text" as const, text: value });
const material = (name: string) =>
  ({
    type: "data-material",
    data: { materialId: `m-${name}`, name, mediaType: "application/pdf" },
  }) as ChatUIMessage["parts"][number];

/** A reply that remembered a line, its result as stored. */
const reply = (id: string) =>
  ({
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-remember",
        toolCallId: `call-${id}`,
        state: "output-available",
        input: { text: `Line ${id}` },
        output: { ok: true },
      },
      text("Noted."),
    ],
  }) as ChatUIMessage;

const outputs = (history: ChatUIMessage[]) =>
  history.flatMap(({ parts }) =>
    parts.flatMap((part) => ("output" in part ? [part.output] : [])),
  );

test("tool results older than the third-newest Student message become their step summary", () => {
  const history = [
    student("s1", text("a")),
    reply("r1"),
    student("s2", text("b")),
    reply("r2"),
    student("s3", text("c")),
    reply("r3"),
    student("s4", text("d")),
  ];
  expect(outputs(modelHistory(history))).toEqual([
    "Noted: Line r1",
    { ok: true },
    { ok: true },
  ]);
  // The stored messages are unchanged.
  expect(outputs(history)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
});

test("with three Student messages or fewer, every result stays whole", () => {
  const history = [
    student("s1", text("a")),
    reply("r1"),
    student("s2", text("b")),
  ];
  expect(modelHistory(history)).toEqual(history);
});

test("only the newest Student message keeps its Materials as files", () => {
  const history = modelHistory([
    student("s1", text("See this"), material("Lecture 1.pdf")),
    reply("r1"),
    student("s2", material("Sheet 2.pdf")),
  ]);
  expect(history[0]!.parts).toEqual([
    text("See this"),
    text("[Attached: Lecture 1.pdf]"),
  ]);
  expect(history[2]!.parts).toEqual([material("Sheet 2.pdf")]);
});
