// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import { getUser } from "@/lib/auth/user";
import { TUTOR_INSTRUCTIONS } from "@/lib/ai/tutor";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
// `after` needs a Next.js request scope, which unit tests don't have.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ getUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(getUser).mockResolvedValue({
    id: "user-1",
    email: "student@example.com",
  });
});

function chatRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Joins the text deltas of a UI message stream (server-sent events). */
async function streamedText(response: Response) {
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return events
    .filter((event) => event.type === "text-delta")
    .map((event) => event.delta)
    .join("");
}

const userMessage = {
  id: "msg-1",
  role: "user",
  parts: [{ type: "text", text: "How do I solve 2x + 3 = 11?" }],
};

test("streams the tutor's reply with the tutor instructions", async () => {
  const tutor = mockTextModel("What have you tried so far?");
  useMockModels({ tutor });

  const response = await POST(
    chatRequest({ id: "chat-1", messages: [userMessage] }),
  );

  expect(response.status).toBe(200);
  expect(await streamedText(response)).toBe("What have you tried so far?");

  const [call] = tutor.doStreamCalls;
  expect(call.prompt[0]).toEqual({
    role: "system",
    content: TUTOR_INSTRUCTIONS,
  });
  expect(call.prompt.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "How do I solve 2x + 3 = 11?" }],
  });
});

test("rejects requests without a signed-in user", async () => {
  vi.mocked(getUser).mockResolvedValue(null);
  const tutor = mockTextModel("unused");
  useMockModels({ tutor });

  const response = await POST(
    chatRequest({ id: "chat-1", messages: [userMessage] }),
  );

  expect(response.status).toBe(401);
  expect(tutor.doStreamCalls).toHaveLength(0);
});

test("rejects a body without messages", async () => {
  useMockModels({ tutor: mockTextModel("unused") });

  const response = await POST(chatRequest({ id: "chat-1", messages: [] }));

  expect(response.status).toBe(400);
});

test("rejects malformed messages", async () => {
  useMockModels({ tutor: mockTextModel("unused") });

  const response = await POST(
    chatRequest({ messages: [{ role: "user", text: "missing parts" }] }),
  );

  expect(response.status).toBe(400);
});
