import { z } from "zod";

export const startExampleJobSchema = z.object({
  items: z.array(z.string().max(1000)).min(1).max(100),
});
