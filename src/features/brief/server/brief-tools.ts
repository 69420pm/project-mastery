import "server-only";
import type {
  BriefToolActions,
  SaveBriefInput,
  SetExamScopeInput,
} from "@/features/brief/ai/tools";
import type { BriefContext } from "@/features/brief/domain/intake";
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
 * What the Brief's tools do, as the signed-in Student, to the Course's
 * Brief. `context` holds the Course's Materials, Big ideas and Topics when
 * the reply started, and `studentTexts` the Student's messages so far. Each
 * tool writes in one transaction, so a failed call changes nothing.
 */
export function briefToolActions(
  supabase: Supabase,
  courseId: string,
  context: BriefContext,
  studentTexts: string[],
): BriefToolActions {
  const known = new Set(context.materials.map(({ id }) => id));
  const ofCourse = (ids: string[] | undefined) => ({
    kept: ids?.filter((id) => known.has(id)) ?? null,
    unknown: ids?.filter((id) => !known.has(id)) ?? [],
  });

  return {
    async saveBrief(input: SaveBriefInput) {
      const fields: BriefFieldsUpdate = Object.fromEntries(
        Object.entries({
          exam_date: given(input.examDate),
          goal: given(input.goal),
          hours_per_week: given(input.hoursPerWeek),
          question_style: given(input.questionStyle),
          open_book: given(input.openBook),
          formula_sheet: given(input.formulaSheet),
          calculator: given(input.calculator),
          scope_confirmed: given(input.scopeConfirmed),
        }).filter(([, value]) => value !== undefined),
      );

      // Only the Course's own Materials count; other ids are dropped.
      const excluded = ofCourse(given(input.excludedMaterialIds));
      const exams = ofCourse(given(input.examMaterialIds));

      // Only an old exam of the Course can be reserved; another id is
      // dropped. Once a submitted mock used the reservation, it stays as it is.
      const examIds = new Set(exams.kept ?? context.exams.map(({ id }) => id));
      const reserved = given(input.reservedExamMaterialId);
      const reservable = reserved === "none" || examIds.has(reserved ?? "");
      const used =
        reserved !== undefined &&
        context.reservedExam.materialId !== null &&
        (await getReservedExam(supabase, courseId)) === null;
      if (reserved !== undefined && reservable && !used) {
        fields.reserved_exam_material_id =
          reserved === "none" ? null : reserved;
        fields.reserved_exam_answered = true;
      }

      await saveBrief(supabase, courseId, fields, {
        excludedMaterialIds: excluded.kept,
        examMaterialIds: exams.kept,
      });
      const unknown = [...excluded.unknown, ...exams.unknown];
      const ignored = [
        unknown.length > 0 &&
          `These are no Material ids of the Course and were ignored: ${unknown.join(", ")}.`,
        reserved !== undefined &&
          !reservable &&
          `${reserved} is no old exam of the Course and was ignored: send the id of one, or "none".`,
        used &&
          "The reserved exam was ignored: the Student has taken it as their final mock exam, so it can no longer change.",
      ].filter(Boolean);
      return ["Saved.", ...ignored].join(" ");
    },

    async addNote(text) {
      return (await addBriefNote(supabase, courseId, text))
        ? "Saved."
        : "Not saved: the notes are full. Nothing changed.";
    },

    async setExamScope(input: SetExamScopeInput) {
      const bigIdeaId = given(input.bigIdeaId) ?? null;
      const topicId = given(input.topicId) ?? null;
      if ((bigIdeaId === null) === (topicId === null)) {
        return "Not saved: give the id of one Big idea or of one Topic. Nothing changed.";
      }
      const inCourse =
        bigIdeaId !== null
          ? context.bigIdeas.some(({ id }) => id === bigIdeaId)
          : context.bigIdeas.some(({ topics }) =>
              topics.some(({ id }) => id === topicId),
            );
      if (!inCourse) {
        return `Not saved: ${bigIdeaId ?? topicId} is no Big idea or Topic of the Course. Nothing changed.`;
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
        bigIdeaId,
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
