import { describe, expect, test } from "vitest";
import type { BriefUIMessage } from "@/features/brief/types";
import { STATIC_MODEL_ID, withNewStaticMessages } from "./static-messages";

function message(
  id: string,
  role: "user" | "assistant",
  modelId?: string,
): BriefUIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text: id }],
    ...(modelId && { metadata: { modelId } }),
  };
}

const opening = message("opening", "assistant", STATIC_MODEL_ID);
const question = message("finding-2", "assistant", STATIC_MODEL_ID);

describe("withNewStaticMessages", () => {
  test("appends the next Finding's question once, not the stored reply", () => {
    // The client's reply id need not match the stored one.
    const shown = [
      opening,
      message("u1", "user"),
      message("client-reply", "assistant"),
    ];
    const stored = [
      opening,
      message("u1", "user"),
      message("stored-reply", "assistant", "gemini"),
      question,
    ];

    const merged = withNewStaticMessages(shown, stored);
    expect(merged.map(({ id }) => id)).toEqual([
      "opening",
      "u1",
      "client-reply",
      "finding-2",
    ]);
    expect(withNewStaticMessages(merged, stored)).toBe(merged);
  });
});
