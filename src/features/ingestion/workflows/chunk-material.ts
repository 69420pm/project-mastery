import "server-only";
import { generateText } from "ai";
import {
  fileCallSettings,
  fileMessages,
  fileResultSchema,
} from "@/features/ingestion/ai/file-chunks";
import { storedUnitsSchema } from "@/features/ingestion/ai/page-units";
import {
  chunksFromFileResult,
  coverageProblems,
  materialUnits,
  type MaterialUnit,
} from "@/features/ingestion/domain/file-chunks";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  dailyQuotaAsNull,
  fail,
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { answeringModel } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * The file call of a parse (step 3 of `parse-material.ts`): one text call
 * (task `ingest`) over all the Material's units groups them into its final
 * chunks and finds exam metadata. Code checks that every unit lands in
 * exactly one chunk and every page is covered, or the step throws and
 * retries. The chunks replace any earlier ones in one transaction, and the
 * Material is marked parsed.
 */
export async function chunkMaterial(materialId: string): Promise<ParseOutcome> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return { ok: true };
  const studentId = material.owner;

  const pages = await supabase
    .from("material_pages")
    .select("page_number, units")
    .eq("material_id", materialId);
  if (pages.error) fail("Loading the page results", pages.error);
  const units = materialUnits(
    pages.data.map((page) => ({
      pageNumber: page.page_number,
      units: storedUnitsSchema.parse(page.units),
    })),
  );
  const pageNumbers = pages.data.map((page) => page.page_number);
  if (!hasUnits(units)) {
    throw new Error("The Material's pages have no units to chunk.");
  }

  const dailyLimit = await checkDailyLimit(supabase, { studentId });
  if (dailyLimit.level === "reached") {
    return { ok: false, reason: dailyLimitReason };
  }

  const settings = fileCallSettings(units);
  const result = await withTraceAttributes(
    { userId: studentId, traceName: "parse-file" },
    () => generateText({ ...settings, messages: fileMessages(units) }),
  ).catch(dailyQuotaAsNull);
  if (!result) return { ok: false, reason: dailyLimitReason };
  await recordAiUsage(
    supabase,
    {
      task: "ingest",
      modelId: answeringModel(settings, result.response.modelId),
      usage: tokenUsage(result.usage),
    },
    { studentId },
  );

  const ids = units.map((unit) => unit.id) as [string, ...string[]];
  const { chunks, exam } = fileResultSchema(ids).parse(result.output);
  const problems = coverageProblems(units, chunks, pageNumbers);
  if (problems.length > 0) {
    throw new Error(
      `The file call's chunks do not cover the Material: ${problems.join(" ")}`,
    );
  }

  const oldExam = exam?.isOldExam ? exam : null;
  const replaced = await supabase.rpc("replace_material_chunks", {
    p_material_id: materialId,
    p_chunks: chunksFromFileResult(units, chunks).map((chunk) => ({
      position: chunk.position,
      page_from: chunk.pageFrom,
      page_to: chunk.pageTo,
      label: chunk.label,
      markdown: chunk.markdown,
      figure: chunk.figure,
      exercise_number: chunk.exerciseNumber,
      points: chunk.points,
    })),
    p_is_exam: oldExam !== null,
    // Left out when unknown: the function's default is null.
    p_exam_year: oldExam?.year ?? undefined,
    p_exam_total_points: oldExam?.totalPoints ?? undefined,
  });
  if (replaced.error) fail("Storing the chunks", replaced.error);

  const { error } = await supabase
    .from("materials")
    .update({ parse_status: "parsed", parse_failure: null })
    .eq("id", materialId);
  if (error) fail("Finishing the parse", error);
  return { ok: true };
}

function hasUnits(
  units: MaterialUnit[],
): units is [MaterialUnit, ...MaterialUnit[]] {
  return units.length > 0;
}
