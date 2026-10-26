// @vitest-environment node
import { expect, test, vi } from "vitest";
import { closeEval, scoreClose } from "./close";
import { loadFixture } from "./eval";

vi.mock("server-only", () => ({}));

test("the fixture holds 3 draft items, one with a Memory over 3,000 characters and 3 pins", async () => {
  const { items } = await loadFixture(closeEval);
  expect(items).toHaveLength(3);
  expect(items.every((i) => i.expectedOutput.labelStatus === "draft")).toBe(
    true,
  );
  const long = items.find((i) => i.expectedOutput.keepsPins)!;
  expect(long.input.memoryLines.join("\n").length).toBeGreaterThan(3_000);
  expect(long.input.memoryLines.filter((l) => l.startsWith("!"))).toHaveLength(
    3,
  );
});

test("scoring checks the keywords, the pins and the old claims on the call's own notes", async () => {
  const { items } = await loadFixture(closeEval);
  const [repeated, long, contradicted] = items;
  const notes = (over: object) =>
    JSON.stringify({
      sessionNote: "a\nb",
      topicNote: null,
      memoryLines: [],
      condensedMemory: null,
      ...over,
    });
  const ok = (item: (typeof items)[number], output: string) =>
    scoreClose(item!.input, output, item!.expectedOutput).every((c) => c.ok);

  expect(
    ok(
      repeated!,
      notes({
        topicNote: "Twice left out the flight speed.",
        memoryLines: ["Prefers a worked number first."],
      }),
    ),
  ).toBe(true);
  expect(
    ok(repeated!, notes({ topicNote: "Left out the flight speed." })),
  ).toBe(false);

  const pins = long!.input.memoryLines.filter((l) => l.startsWith("!"));
  expect(ok(long!, notes({ condensedMemory: pins.join("\n") }))).toBe(true);
  expect(ok(long!, notes({ condensedMemory: pins[0] }))).toBe(false);

  expect(
    ok(
      contradicted!,
      notes({ topicNote: "Now includes the flight speed unprompted." }),
    ),
  ).toBe(true);
  expect(
    ok(contradicted!, notes({ topicNote: "Still omits the flight speed." })),
  ).toBe(false);
});
