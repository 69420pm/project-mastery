import { z } from "zod";

/** The Material whose parse the Parse or Retry button starts. */
export const startMaterialParseSchema = z.object({ materialId: z.uuid() });
