// @vitest-environment node
// The chat handler's flagMap tool and the map Findings getTopic lists.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MAP,
  STUDENT,
  db,
  seedMap,
  send,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

test("flagMap files a Finding in the Chat's session, which getTopic lists under both KCs", async () => {
  const model = mockToolModel(
    [
      [
        {
          toolName: "flagMap",
          input: {
            kind: "wrong_link",
            kcId: MAP.efficiency,
            linkedKcId: MAP.thrust,
            chunkId: MAP.chunks[0],
            quote: "chunk 0:",
            reason: "Efficiency does not need thrust first.",
          },
        },
      ],
      [{ toolName: "getTopic", input: { topicId: MAP.topic } }],
    ],
    "Noted.",
  );
  useMockModels({ chat: model });
  seedMap();
  db.tables.map_findings.push({
    owner: STUDENT,
    course_id: COURSE,
    kind: "wrong_description",
    kc_id: MAP.thrust,
    linked_kc_id: null,
    reason: "Dismissed earlier.",
    status: "dismissed",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const chatId = randomUUID();

  await send({ chatId, courseId: COURSE, message: userMessage("Hi.") });

  const [, filed] = db.tables.map_findings;
  const session = db.tables.study_sessions.find(
    (row) => row.chat_id === chatId,
  );
  expect(filed).toMatchObject({
    study_session_id: session!.id,
    kind: "wrong_link",
    kc_id: MAP.efficiency,
    linked_kc_id: MAP.thrust,
    chunk_id: MAP.chunks[0],
    status: "open",
  });
  const topic = JSON.stringify(model.doStreamCalls[2]!.prompt.at(-1));
  const listed = (other: string) =>
    `"findings":[{"kind":"wrong_link","otherKc":{"id":"${other}"`;
  expect(topic).toContain(listed(MAP.thrust));
  expect(topic).toContain(listed(MAP.efficiency));
  expect(topic).not.toContain("Dismissed earlier.");
});
