// @vitest-environment node
// The Brief handler: what each tool result tells the model on the next step.
// Shared setup and helpers: handler-testing.ts.
import { describe, expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MISMATCH,
  OLD_EXAM,
  SCOPE,
  STUDENT,
  db,
  send,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

function seedBrief(notes: string | null = null) {
  db.tables.briefs.push({
    course_id: COURSE,
    owner: STUDENT,
    exam_date: "2026-12-03",
    goal: "pass",
    hours_per_week: 5,
    question_style: "written",
    open_book: false,
    formula_sheet: false,
    calculator: true,
    scope_confirmed: true,
    notes,
  });
}

/** A model that makes one tool call, then replies "Ok.". */
const toolModel = (toolName: string, input: Record<string, unknown>) =>
  mockToolModel([[{ toolName, input }]], "Ok.");

/** Sends a message to `model` and returns the prompt of its last step. */
async function lastPrompt(model: ReturnType<typeof toolModel>) {
  await send({ courseId: COURSE, message: userMessage("…") });
  return JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
}

describe("a tool result", () => {
  test("saveBrief names the ids it ignored", async () => {
    const model = toolModel("saveBrief", {
      excludedMaterialIds: [OLD_EXAM, "not-a-material"],
    });
    useMockModels({ brief: model });

    const prompt = await lastPrompt(model);

    expect(prompt).toContain(
      "These are no Material ids of the Course and were ignored: not-a-material.",
    );
  });

  test("answerFinding on the last open Finding says the Student is done", async () => {
    seedBrief();
    const scope = db.tables.findings.find((row) => row.id === SCOPE)!;
    scope.status = "answered";

    const model = toolModel("answerFinding", {
      findingId: MISMATCH,
      answer: "50.8% is right",
    });
    useMockModels({ brief: model });

    const prompt = await lastPrompt(model);

    expect(prompt).toContain("tell the Student they are done");
    expect(db.tables.findings[0]).toMatchObject({ status: "answered" });
  });

  test("addNote over the notes' limit changes nothing and says so", async () => {
    const full = "x".repeat(19_990);
    seedBrief(full);

    const model = toolModel("addNote", { text: "Heat exchangers!" });
    useMockModels({ brief: model });

    const prompt = await lastPrompt(model);

    expect(prompt).toContain("Not saved: the notes are full. Nothing changed.");
    expect(db.tables.briefs[0]?.notes).toBe(full);
  });
});
