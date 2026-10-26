import { expect, test } from "vitest";
import { topicNoteIds } from "./notes";

const topics = [
  { id: "t1", kcs: ["a", "b"] },
  { id: "t2", kcs: ["c"] },
  { id: "t3", kcs: ["d", "e"] },
];

test("topicNoteIds lists the Topic first, then the Topics holding its anchors", () => {
  expect(topicNoteIds("t3", topics, ["b", "c", "x"])).toEqual([
    "t3",
    "t1",
    "t2",
  ]);
});

test("topicNoteIds lists the Topic alone without anchors, and never twice", () => {
  expect(topicNoteIds("t2", topics, [])).toEqual(["t2"]);
  expect(topicNoteIds("t2", topics, ["c"])).toEqual(["t2"]);
});
