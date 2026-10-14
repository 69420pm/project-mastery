import { randomUUID } from "node:crypto";
import { respondInBrief } from "@/features/brief/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { Supabase } from "@/lib/supabase/types";
import { result, type SmokeCheck } from "./smoke-check";

/** What the Student tells the AI, one message per reply. */
const MESSAGES = [
  "Exam is 2026-12-03, closed book, calculator allowed, written. I want a good grade and have 6 hours a week.",
  "Skip the old exam file. The lecturer said heat exchangers are important.",
];

/** Sends one message through the Brief handler and returns the reply's text. */
async function send(
  client: Supabase,
  studentId: string,
  courseId: string,
  text: string,
) {
  const response = await respondInBrief({
    request: new Request("http://localhost/api/brief", {
      method: "POST",
      body: JSON.stringify({
        courseId,
        message: {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      }),
    }),
    supabase: client,
    userId: studentId,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  for (const chunk of chunks) {
    if (chunk.type === "tool-input-available") {
      console.info(`  ${chunk.toolName} ${JSON.stringify(chunk.input)}`);
    }
    if (chunk.type === "tool-output-error" || chunk.type === "error") {
      console.info(`  ${chunk.type}: ${chunk.errorText}`);
    }
  }
  return chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
}

/**
 * Tells the AI about an exam in a new Course's Brief, in two scripted
 * messages through the real handler, and checks what the tools stored.
 */
export const briefSmoke: SmokeCheck = {
  name: "brief",
  usage: "pnpm smoke brief (two scripted messages in a Course's Brief)",
  maxCalls: 6,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const materialId = randomUUID();
    const material = await supabase.from("materials").insert({
      id: materialId,
      owner: studentId,
      course_id: course.id,
      name: "Old exam 2024",
      media_type: "application/pdf",
      size_bytes: 1,
      storage_path: `${studentId}/${course.id}/${materialId}`,
    });
    if (material.error) throw new Error(material.error.message);

    // The Brief runs as the Student, with Row Level Security as in the app.
    const client = await signInAsUser(supabase, studentId);
    for (const text of MESSAGES) {
      console.info(`Student: ${text}`);
      console.info(`AI: ${await send(client, studentId, course.id, text)}`);
    }

    const [brief, excluded] = await Promise.all([
      supabase
        .from("briefs")
        .select(
          "exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes",
        )
        .eq("course_id", course.id)
        .single(),
      supabase
        .from("brief_excluded_materials")
        .select("material_id")
        .eq("course_id", course.id),
    ]);
    if (brief.error) throw new Error(brief.error.message);
    if (excluded.error) throw new Error(excluded.error.message);
    const b = brief.data;
    const expected = {
      exam_date: "2026-12-03",
      goal: "good_grade",
      hours_per_week: 6,
      question_style: "written",
      open_book: false,
      calculator: true,
    };
    const fields = Object.entries(expected).map(([column, value]) =>
      result(
        `${column} is ${value}`,
        b[column as keyof typeof expected] === value,
        String(b[column as keyof typeof expected]),
      ),
    );
    const excludedIds = excluded.data.map((row) => row.material_id);
    return [
      ...fields,
      // The Student never said, so the AI must not invent it.
      result(
        "formula_sheet is still unanswered",
        b.formula_sheet === null,
        String(b.formula_sheet),
      ),
      result(
        "the old exam is excluded",
        excludedIds.length === 1 && excludedIds[0] === materialId,
        `${excludedIds.length} excluded`,
      ),
      result("the scope is confirmed", b.scope_confirmed),
      result(
        "the notes mention heat exchangers",
        b.notes?.toLowerCase().includes("heat exchangers") ?? false,
        JSON.stringify(b.notes),
      ),
    ];
  },
};
