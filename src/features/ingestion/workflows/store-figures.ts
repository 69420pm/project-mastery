import "server-only";
import type { PageUnit } from "@/features/ingestion/ai/page-units";
import { cropFigure } from "@/features/ingestion/workflows/figure-crops";
import type { AdminSupabase } from "@/lib/supabase/types";

/** Where the figure crops of a Material are stored: under its own path. */
function figurePath(storagePath: string, pageNumber: number, index: number) {
  return `${storagePath}/figures/${pageNumber}-${index}.png`;
}

/**
 * Gives each figure of a page's units the picture the chunk view shows:
 * a crop of the page image, stored in the bucket, or the whole page image
 * when the figure's box cannot be used.
 */
export async function storeFigures(
  supabase: AdminSupabase,
  options: {
    bucket: string;
    storagePath: string;
    pageNumber: number;
    pageImagePath: string;
    pageImage: Uint8Array;
  },
  units: readonly PageUnit[],
) {
  const { bucket, storagePath, pageNumber, pageImagePath, pageImage } = options;
  return Promise.all(
    units.map(async (unit, index) => {
      if (!unit.figure) return { ...unit, figure: null };
      const crop = await cropFigure(pageImage, unit.figure.box);
      if (!crop) {
        return { ...unit, figure: { ...unit.figure, cropPath: pageImagePath } };
      }
      const cropPath = figurePath(storagePath, pageNumber, index);
      const { error } = await supabase.storage
        .from(bucket)
        .upload(cropPath, crop, { contentType: "image/png", upsert: true });
      if (error) {
        throw new Error(`Storing the figure crop failed: ${error.message}`);
      }
      return { ...unit, figure: { ...unit.figure, cropPath } };
    }),
  );
}
