import "server-only";
import { createHash } from "node:crypto";
import { storedUnitsSchema } from "@/features/ingestion/ai/page-units";
import { chunkChapters } from "@/features/ingestion/domain/chapters";
import { joinUnits } from "@/features/ingestion/domain/chunk-joining";
import { exerciseKeys } from "@/features/ingestion/domain/exercise-keys";
import { buildParts } from "@/features/ingestion/domain/parts";
import { openMaterialPdf } from "@/features/ingestion/workflows/page-images";
import { loadMaterial } from "@/features/ingestion/workflows/parse-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The chunk step of a parse (`parse-material.ts`): joins the units of the
 * Material's read pages into chunks (`joinUnits`), finds their chapters
 * from the PDF's outline and groups them into Parts (`buildParts`), and
 * stores both in one transaction, replacing any earlier ones.
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
  const chunks = joinUnits(
    pages.data.map((page) => ({
      pageNumber: page.page_number,
      units: storedUnitsSchema.parse(page.units),
    })),
  );

  const outline =
    material.media_type === "application/pdf"
      ? await (await openMaterialPdf(supabase, material.storage_path)).outline()
      : [];
  const keys = exerciseKeys(chunks);
  const chapters = chunkChapters(chunks, outline, material.name);
  const parts = buildParts(
    chunks.map((chunk, index) => ({
      ...chunk,
      key: keys[index] ?? null,
      chapter: chapters[index] ?? material.name,
    })),
    material.name,
  );

  const partOf = new Map<number, number>();
  parts.forEach((part, position) => {
    for (const index of part.chunks) partOf.set(index, position);
  });
  const replaced = await supabase.rpc("replace_material_chunks", {
    p_material_id: materialId,
    p_parts: parts.map((part, position) => {
      const members = part.chunks.map((index) => chunks[index]!);
      return {
        position,
        kind: part.kind,
        title: part.title.slice(0, 500),
        chapter_title: part.chapterTitle.slice(0, 500),
        page_from: Math.min(...members.map((chunk) => chunk.pageFrom)),
        page_to: Math.max(...members.map((chunk) => chunk.pageTo)),
        content_hash: createHash("sha256")
          .update(members.map((chunk) => chunk.markdown).join("\n\n"))
          .digest("hex"),
      };
    }),
    p_chunks: chunks.map((chunk, position) => ({
      position,
      page_from: chunk.pageFrom,
      page_to: chunk.pageTo,
      label: chunk.label,
      markdown: chunk.markdown,
      exercise_number: chunk.exerciseNumber,
      part_position: partOf.get(position) ?? null,
    })),
  });
  if (replaced.error) failed("Storing the chunks", replaced.error);
}
