import "server-only";
import { storedUnitsSchema } from "@/features/ingestion/ai/page-units";
import { loadMaterial } from "@/features/ingestion/workflows/parse-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The chunk step of a parse (`parse-material.ts`): every unit of the
 * Material's read pages becomes a chunk, in reading order, with its label,
 * its page and its exercise number as printed. The chunks replace any
 * earlier ones in one transaction.
 */
export async function chunkMaterial(materialId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return;

  // Chunks are written in one transaction after every page is read, so
  // existing ones are complete: a parse started again after a failed embed
  // keeps them, and their vectors.
  const existing = await supabase
    .from("chunks")
    .select("id")
    .eq("material_id", materialId)
    .limit(1);
  if (existing.error) failed("Loading the chunks", existing.error);
  if (existing.data.length > 0) return;

  const pages = await supabase
    .from("material_pages")
    .select("page_number, units")
    .eq("material_id", materialId)
    .order("page_number");
  if (pages.error) failed("Loading the page results", pages.error);
  const chunks = pages.data
    .flatMap((page) =>
      storedUnitsSchema.parse(page.units).map((unit) => ({
        page_from: page.page_number,
        page_to: page.page_number,
        label: unit.label,
        markdown: unit.markdown,
        exercise_number: unit.exerciseNumber,
      })),
    )
    .map((chunk, position) => ({ position, ...chunk }));

  const replaced = await supabase.rpc("replace_material_chunks", {
    p_material_id: materialId,
    p_chunks: chunks,
  });
  if (replaced.error) failed("Storing the chunks", replaced.error);
}
