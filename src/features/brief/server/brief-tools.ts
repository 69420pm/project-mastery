import "server-only";
import type {
  BriefToolActions,
  SaveBriefInput,
} from "@/features/brief/ai/tools";
import { findingQuestion, reviewQueue } from "@/features/brief/domain/findings";
import type { BriefContext } from "@/features/brief/domain/intake";
import {
  answerFinding,
  getOpenFindings,
  markFindingAsked,
} from "@/features/knowledge-map/server";
import {
  addBriefNote,
  saveBrief,
  type BriefFieldsUpdate,
} from "@/features/brief/server/brief-store";
import type { Supabase } from "@/lib/supabase/types";

/** Null, as the models send for a field they leave out, means "not given". */
const given = <T>(value: T | null | undefined) => value ?? undefined;

/**
 * What the Brief's tools do, as the signed-in Student, to the Course's
 * Brief. `context` holds the Course's Materials when the reply started.
 * Each tool writes in one transaction, so a failed call changes nothing.
 */
export function briefToolActions(
  supabase: Supabase,
  courseId: string,
  context: BriefContext,
): BriefToolActions {
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

      const excluded = given(input.excludedMaterialIds);
      // Only the Course's own Materials can be excluded; other ids are dropped.
      const known = new Set(context.materials.map(({ id }) => id));
      const unknown = excluded?.filter((id) => !known.has(id)) ?? [];
      await saveBrief(
        supabase,
        courseId,
        fields,
        excluded ? excluded.filter((id) => known.has(id)) : null,
      );
      return unknown.length > 0
        ? `Saved. These are no Material ids of the Course and were ignored: ${unknown.join(", ")}.`
        : "Saved.";
    },

    async addNote(text) {
      return (await addBriefNote(supabase, courseId, text))
        ? "Saved."
        : "Not saved: the notes are full. Nothing changed.";
    },

    async answerFinding(findingId, answer) {
      if (!(await answerFinding(supabase, courseId, findingId, answer))) {
        return "Not saved: that is no question about this Course's materials. Nothing changed.";
      }
      const { asking } = reviewQueue(await getOpenFindings(supabase, courseId));
      if (!asking) {
        return "Saved. No questions about the materials are left: tell the Student they are done.";
      }
      await markFindingAsked(supabase, courseId, asking.id);
      return `Saved. In this reply, ask the Student the next question about the materials (id ${asking.id}), with its sources:\n${findingQuestion(asking)}`;
    },
  };
}
