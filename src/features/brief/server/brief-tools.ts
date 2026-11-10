import "server-only";
import type {
  BriefToolActions,
  SaveBriefInput,
  SetExamScopeInput,
} from "@/features/brief/ai/tools";
import type { BriefContext } from "@/features/brief/domain/intake";
import {
  repeatsNote,
  restatesFormat,
  splitNotes,
} from "@/features/brief/domain/notes";
import {
  addBriefNote,
  saveBrief,
  type BriefFieldsUpdate,
} from "@/features/brief/server/brief-store";
import { storeExamScope } from "@/features/brief/server/exam-scopes";
import { getReservedExam } from "@/features/brief/server/queries";
import type { Supabase } from "@/lib/supabase/types";

/** Null, as the models send for a field they leave out, means "not given". */
const given = <T>(value: T | null | undefined) => value ?? undefined;

/** Text as `setExamScope` compares it: lower case, whitespace collapsed. */
const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * How often one reply may call each tool. A reply needs one saveBrief, or
 * two after an ignored id; more calls are a model looping, as one reply
 * that called saveBrief 28 times and addNote 8 times in one step did.
 */
export const TOOL_CALL_LIMITS = { saveBrief: 3, addNote: 4, setExamScope: 8 };

/** The most tool calls one reply makes before it must answer in text. */
export const MAX_TOOL_CALLS = Object.values(TOOL_CALL_LIMITS).reduce(
  (sum, limit) => sum + limit,
);

/** A reserved exam the model sent as `"none"`, with the quotes, is none. */
function reservedId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const id = value.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return id.toLowerCase() === "none" ? "none" : id;
}

/**
 * What the Brief's tools do, as the signed-in Student, to the Course's
 * Brief, for one reply. `context` holds the Brief, the Course's Materials,
 * Chapters and Topics when the reply started, `studentTexts` the Student's
 * messages so far and `askedChapterIds` the Chapters the Student was asked
 * about as old exams. Each tool writes in one transaction, so a failed call
 * changes nothing. Within the reply, a call that repeats an earlier one, a
 * call over `TOOL_CALL_LIMITS` and a note the notes already hold or that
 * only restates the exam format change nothing and say so.
 */
export function briefToolActions(
  supabase: Supabase,
  courseId: string,
  context: BriefContext,
  studentTexts: string[],
  askedChapterIds: string[],
): BriefToolActions {
  const known = (ids: Iterable<string>) => {
    const set = new Set(ids);
    return (given: string[] | undefined) => ({
      kept: given?.filter((id) => set.has(id)) ?? null,
      unknown: given?.filter((id) => !set.has(id)) ?? [],
    });
  };
  const chapters = new Map(
    context.materials.flatMap(({ chapters }) =>
      chapters.map((chapter) => [chapter.id, chapter] as const),
    ),
  );
  const ofMaterials = known(context.materials.map(({ id }) => id));
  const ofChapters = known(chapters.keys());

  // What this reply has stored so far, so later calls see earlier ones.
  let examIds = new Set(
    [...chapters.values()].filter(({ exam }) => exam).map(({ id }) => id),
  );
  let scopeConfirmed = context.fields.scopeConfirmed;
  const notes = splitNotes(context.notes);
  const calls = new Map<string, number>();
  const made = new Set<string>();

  /** Why a call changes nothing: a repeat or one over the limit; else null. */
  function refused(tool: keyof typeof TOOL_CALL_LIMITS, input: unknown) {
    const key = `${tool}:${JSON.stringify(input)}`;
    if (made.has(key)) {
      return "Not saved: this reply already made this call. Nothing changed. Reply to the Student now.";
    }
    const count = (calls.get(tool) ?? 0) + 1;
    calls.set(tool, count);
    if (count > TOOL_CALL_LIMITS[tool]) {
      return `Not saved: this reply has called ${tool} too often. Nothing changed. Reply to the Student now.`;
    }
    made.add(key);
    return null;
  }

  return {
    async saveBrief(input: SaveBriefInput) {
      const refusal = refused("saveBrief", input);
      if (refusal) return refusal;

      const fields: BriefFieldsUpdate = Object.fromEntries(
        Object.entries({
          exam_date: given(input.examDate),
          goal: given(input.goal),
          open_book: given(input.openBook),
          formula_sheet: given(input.formulaSheet),
          calculator: given(input.calculator),
          // Answering the scope step ends intake; nothing undoes it.
          scope_confirmed: input.scopeConfirmed === true ? true : undefined,
        }).filter(([, value]) => value !== undefined),
      );

      // Only the Course's own Materials and the Chapters the context lists
      // count; other ids are dropped.
      const excluded = ofMaterials(given(input.excludedMaterialIds));
      const exams = ofChapters(given(input.examChapterIds));
      let examChapterIds = exams.kept;
      let asked = askedChapterIds;

      // Only an old exam of the Course can be reserved: one this call or an
      // earlier one marks, or one proposed as likely, which reserving marks
      // an old exam too, as the Student keeps only an old exam aside.
      // Another id is dropped. Once a submitted mock used the reservation,
      // it stays as it is.
      const reserved = reservedId(given(input.reservedExamChapterId));
      const marked = new Set(examChapterIds ?? examIds);
      const proposed =
        reserved !== undefined &&
        !marked.has(reserved) &&
        chapters.get(reserved)?.proposed === true;
      if (proposed) {
        // Without examChapterIds the call keeps every other answer as is.
        if (examChapterIds === null) asked = [];
        examChapterIds = [...marked, reserved];
      }
      const reservable =
        reserved === "none" || marked.has(reserved ?? "") || proposed;
      const used =
        reserved !== undefined &&
        context.reservedExam.chapterId !== null &&
        (await getReservedExam(supabase, courseId)) === null;
      if (reserved !== undefined && reservable && !used) {
        fields.reserved_exam_chapter_id = reserved === "none" ? null : reserved;
        fields.reserved_exam_answered = true;
      }
      const ignoredScope =
        input.scopeConfirmed === false && scopeConfirmed === true;

      await saveBrief(supabase, courseId, fields, {
        excludedMaterialIds: excluded.kept,
        examChapterIds,
        askedChapterIds: asked,
        language: given(input.courseLanguage)?.trim() || null,
      });
      if (examChapterIds) examIds = new Set(examChapterIds);
      if (fields.scope_confirmed) scopeConfirmed = true;
      const ignored = [
        excluded.unknown.length > 0 &&
          `These are no Material ids of the Course and were ignored: ${excluded.unknown.join(", ")}.`,
        exams.unknown.length > 0 &&
          `These are no Chapter ids of the Course and were ignored: ${exams.unknown.join(", ")}.`,
        reserved !== undefined &&
          !reservable &&
          `${reserved} is no old exam of the Course and was ignored: send the id of one, or "none".`,
        used &&
          "The reserved exam was ignored: the Student has taken it as their final mock exam, so it can no longer change.",
        proposed &&
          !used &&
          "The reserved exam is now marked an old exam as well.",
        ignoredScope &&
          "scopeConfirmed false was ignored: the scope step stays answered.",
      ].filter(Boolean);
      return ["Saved.", ...ignored].join(" ");
    },

    async addNote(text) {
      if (restatesFormat(text)) {
        return "Not saved: saveBrief already stores whether the exam is open book and whether a formula sheet and a calculator are allowed; notes hold only what no field holds. Nothing changed.";
      }
      if (repeatsNote(text, notes)) {
        return "Not saved: the notes already say this. Nothing changed.";
      }
      const refusal = refused("addNote", text);
      if (refusal) return refusal;
      // Counted before the write, so a note sent twice in one step is kept once.
      notes.push(text);
      if (await addBriefNote(supabase, courseId, text)) return "Saved.";
      notes.pop();
      return "Not saved: the notes are full. Nothing changed.";
    },

    async setExamScope(input: SetExamScopeInput) {
      const refusal = refused("setExamScope", input);
      if (refusal) return refusal;
      const { topicId } = input;
      if (!context.topics.some(({ id }) => id === topicId)) {
        return `Not saved: ${topicId} is no Topic of the Course. Nothing changed.`;
      }
      const words = given(input.words) ?? null;
      if (input.scope !== null) {
        // The Student confirms: their words must come from their messages.
        const said = words !== null && plain(words) !== "";
        if (
          !said ||
          !studentTexts.some((text) => plain(text).includes(plain(words)))
        ) {
          return "Not saved: words must quote the Student's own confirmation from their message. Ask the Student to confirm it in their own words first. Nothing changed.";
        }
      }
      const stored = await storeExamScope(supabase, courseId, {
        topicId,
        scope: input.scope,
        words: input.scope === null ? null : words,
      });
      if (!stored)
        return "Not saved: the Brief was not found. Nothing changed.";
      return input.scope === null ? "Removed." : "Saved.";
    },
  };
}
