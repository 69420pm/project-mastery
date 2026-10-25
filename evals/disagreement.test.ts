// @vitest-environment node
import { expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  checkDisagreement,
  disagreementEval,
  type DisagreementRecord,
} from "./disagreement";
import { loadFixture } from "./eval";

vi.mock("server-only", () => ({}));

/** The ids the eval gives KC11 and KC12 (gold positions 15 and 16). */
const KC11 = "00000000-0000-4000-8000-00000000010f";
const KC12 = "00000000-0000-4000-8000-000000000110";

const passed = (checks: Array<{ name: string; value: number }>) =>
  Object.fromEntries(checks.map(({ name, value }) => [name, value]));

test("the fixture has the planted-errors Student", async () => {
  const { items } = await loadFixture(disagreementEval);
  expect(items.map((item) => item.id)).toEqual(["planted-errors"]);
});

test("a search and a Finding on the planted link are recorded", async () => {
  useMockModels({
    chat: mockToolModel(
      [
        [
          {
            toolName: "searchMaterials",
            input: { query: "compressor combustor order" },
          },
        ],
        [
          {
            toolName: "flagMap",
            input: {
              kind: "wrong_link",
              kcId: KC11,
              linkedKcId: KC12,
              chunkId: "chunk-2",
              quote: "The compressor consists of many rows",
              reason: "The air passes the compressor first.",
            },
          },
        ],
      ],
      "Flagged.",
    ),
  });
  vi.stubEnv("LEARN_EVAL_RPM", "60000");
  const output = await disagreementEval.task({ messages: ["It is wrong."] });
  const record = JSON.parse(output) as DisagreementRecord;
  expect(record.searches).toBe(1);
  expect(record.filed).toMatchObject([
    { kind: "wrong_link", kcId: "KC11", linkedKcId: "KC12" },
  ]);
  expect(record.refusals).toEqual([]);
});

test("a Finding on the wrong claim, or a correction without a citation, fails", async () => {
  const { items } = await loadFixture(disagreementEval);
  const expected = items[0]!.expectedOutput;
  const record: DisagreementRecord = {
    filed: [
      {
        reply: 2,
        kind: "wrong_link",
        kcId: "KC11",
        linkedKcId: "KC12",
        chunkId: "chunk-2",
        quote: "q",
      },
      {
        reply: 2,
        kind: "missing_link",
        kcId: "KC13",
        linkedKcId: "KC11",
        chunkId: "chunk-2",
        quote: "q",
      },
      {
        reply: 2,
        kind: "missing_link",
        kcId: "KC13",
        linkedKcId: "KC12",
        chunkId: "chunk-2",
        quote: "q",
      },
    ],
    replies: ["", "", "The inlet slows the air [p. 1](/x#chunk-2)."],
    searches: 2,
    refusals: [],
    calls: 6,
    costUsd: 0,
  };
  expect(passed(checkDisagreement(record, expected))).toMatchObject({
    finding_wrong_prerequisite: 1,
    finding_missing_link: 1,
    finding_correct_claim: 1,
    no_finding_wrong_claim: 1,
    wrong_claim_corrected_with_citation: 1,
  });

  const flawed: DisagreementRecord = {
    ...record,
    filed: [
      ...record.filed,
      {
        reply: 2,
        kind: "wrong_description",
        kcId: "KC10",
        linkedKcId: null,
        chunkId: "chunk-2",
        quote: "q",
      },
    ],
    replies: ["", "", "You are right, the inlet speeds it up."],
  };
  expect(passed(checkDisagreement(flawed, expected))).toMatchObject({
    no_finding_wrong_claim: 0,
    wrong_claim_corrected_with_citation: 0,
  });
});
