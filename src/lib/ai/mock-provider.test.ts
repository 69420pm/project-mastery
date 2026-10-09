import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { mockReply } = await import("./mock-provider");

const file = (filename: string, mediaType: string) => ({
  type: "file",
  filename,
  mediaType,
  data: { type: "data", data: new Uint8Array([1, 2, 3]) },
});

describe("mockReply", () => {
  test("names the files of the last user message", () => {
    const reply = mockReply([
      { role: "system", content: "Be a tutor." },
      {
        role: "user",
        content: [
          { type: "text", text: "Explain these" },
          file("Lecture 3", "application/pdf"),
          file("Sheet 1", "image/png"),
        ],
      },
    ]);

    expect(reply).toContain('Mock reply to "Explain these".');
    expect(reply).toContain(
      "Attached: Lecture 3 (application/pdf), Sheet 1 (image/png).",
    );
  });

  test("names no files when the last user message has none", () => {
    const reply = mockReply([
      { role: "user", content: [file("Lecture 3", "application/pdf")] },
      { role: "assistant", content: [{ type: "text", text: "Sure." }] },
      { role: "user", content: [{ type: "text", text: "Thanks" }] },
    ]);

    expect(reply).not.toContain("Attached");
  });
});
