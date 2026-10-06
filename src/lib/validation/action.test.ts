import { describe, expect, test } from "vitest";
import { z } from "zod";
import { formDataToObject, parseActionInput } from "./action";

const schema = z.object({
  title: z.string().min(3, "Use at least 3 characters."),
  examDate: z.iso.date().optional(),
  topics: z.array(z.string()).default([]),
});

function formData(entries: [string, string | File][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseActionInput", () => {
  test("returns typed data for a valid plain object", () => {
    expect(parseActionInput(schema, { title: "Linear Algebra" })).toEqual({
      ok: true,
      data: { title: "Linear Algebra", topics: [] },
    });
  });

  test("returns typed data for valid FormData", () => {
    const result = parseActionInput(
      schema,
      formData([
        ["title", "Analysis"],
        ["examDate", "2026-02-10"],
        ["topics", "limits"],
        ["topics", "series"],
      ]),
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Analysis",
        examDate: "2026-02-10",
        topics: ["limits", "series"],
      },
    });
  });

  test("returns field errors as a failed ActionResult", () => {
    const result = parseActionInput(
      schema,
      formData([
        ["title", "AB"],
        ["examDate", "next week"],
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Please check the highlighted fields.");
    expect(result.fieldErrors?.title).toEqual(["Use at least 3 characters."]);
    expect(result.fieldErrors?.examDate).toHaveLength(1);
  });

  test("uses a form-level error as the message", () => {
    const passwords = z
      .object({ password: z.string(), confirm: z.string() })
      .refine((value) => value.password === value.confirm, {
        message: "Passwords do not match.",
      });

    const result = parseActionInput(passwords, {
      password: "a",
      confirm: "b",
    });

    expect(result).toMatchObject({
      ok: false,
      message: "Passwords do not match.",
    });
  });
});

describe("formDataToObject", () => {
  test("turns empty inputs into undefined", () => {
    const object = formDataToObject(
      formData([
        ["title", ""],
        ["file", new File([], "")],
      ]),
    );

    expect(object).toEqual({ title: undefined, file: undefined });
  });

  test("keeps uploaded files", () => {
    const file = new File(["%PDF"], "slides.pdf", { type: "application/pdf" });

    expect(formDataToObject(formData([["file", file]])).file).toBe(file);
  });
});
