import { expect, test } from "vitest";
import { groupFindingsByChunk } from "@/features/knowledge-map/domain/chunk-findings";

const open = { id: "f1", text: "Open one", status: "open", answer: null };
const answered = {
  id: "f2",
  text: "Answered one",
  status: "answered",
  answer: "My answer",
};

test("a Finding shows under each of its chunks of the Material, and chunks of other Materials are left out", () => {
  const result = groupFindingsByChunk(
    [open, answered],
    [
      { finding_id: "f1", chunk_id: "c1" },
      { finding_id: "f1", chunk_id: "c2" },
      { finding_id: "f1", chunk_id: "other" },
      { finding_id: "f2", chunk_id: "c2" },
    ],
    new Set(["c1", "c2"]),
  );

  expect(result).toEqual({
    c1: [{ ...open }],
    c2: [{ ...open }, { ...answered }],
  });
});
