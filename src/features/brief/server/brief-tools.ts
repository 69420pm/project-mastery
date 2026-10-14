import "server-only";
import type {
  BriefToolActions,
  SaveBriefInput,
} from "@/features/brief/ai/tools";
import { appendNote, type BriefContext } from "@/features/brief/domain/intake";
import {
  loadNotes,
  replaceExcludedMaterials,
  updateBrief,
} from "@/features/brief/server/brief-store";
import type { Supabase } from "@/lib/supabase/types";

/** Null, as the models send for a field they leave out, means "not given". */
const given = <T>(value: T | null | undefined) => value ?? undefined;

/**
 * What the Brief's tools do, as the signed-in Student, to the Course's
 * Brief. `context` holds the Course's Materials when the reply started.
 */
export function briefToolActions(
  supabase: Supabase,
  courseId: string,
  context: BriefContext,
): BriefToolActions {
  return {
    async saveBrief(input: SaveBriefInput) {
      const update = Object.fromEntries(
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
      if (Object.keys(update).length > 0) {
        await updateBrief(supabase, courseId, update);
      }

      const excluded = given(input.excludedMaterialIds);
      if (!excluded) return "Saved.";
      // Only the Course's own Materials can be excluded; other ids are dropped.
      const known = new Set(context.materials.map(({ id }) => id));
      const unknown = excluded.filter((id) => !known.has(id));
      await replaceExcludedMaterials(supabase, courseId, [
        ...new Set(excluded.filter((id) => known.has(id))),
      ]);
      return unknown.length > 0
        ? `Saved. These are no Material ids of the Course and were ignored: ${unknown.join(", ")}.`
        : "Saved.";
    },

    async addNote(text) {
      const notes = appendNote(await loadNotes(supabase, courseId), text);
      if (notes === null) {
        return "Not saved: the notes are full. Nothing changed.";
      }
      await updateBrief(supabase, courseId, { notes });
      return "Saved.";
    },
  };
}
