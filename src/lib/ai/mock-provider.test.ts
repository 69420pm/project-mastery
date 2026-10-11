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

describe("structured output on AI_PROVIDER=mock", () => {
  test("answers with an object that fits the schema, its text holding a formula", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { generateText, Output } = await import("ai");
    const { z } = await import("zod");
    const { aiTask } = await import("./models");
    const schema = z.object({
      items: z.array(
        z.object({
          text: z.string(),
          kind: z.enum(["first", "second"]),
          note: z.string().nullable(),
          count: z.number(),
          done: z.boolean(),
        }),
      ),
    });

    const { output } = await generateText({
      ...aiTask("ingest"),
      output: Output.object({ schema }),
      prompt: "Read this page.",
    });

    expect(output).toEqual({
      items: [
        {
          text: expect.stringMatching(/\$[^$]+\$/),
          kind: "first",
          note: null,
          count: 1,
          done: false,
        },
      ],
    });
    vi.unstubAllEnvs();
  });

  test("lists every value of an array of enum values, so ids from the prompt all come back", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { generateText, Output } = await import("ai");
    const { z } = await import("zod");
    const { aiTask } = await import("./models");
    const schema = z.object({
      groups: z.array(z.object({ ids: z.array(z.enum(["a", "b", "c"])) })),
    });

    const { output } = await generateText({
      ...aiTask("ingest"),
      output: Output.object({ schema }),
      prompt: "Group these.",
    });

    expect(output).toEqual({ groups: [{ ids: ["a", "b", "c"] }] });
    vi.unstubAllEnvs();
  });
});
