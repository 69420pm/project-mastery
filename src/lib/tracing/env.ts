import { z } from "zod";
import { parseEnv } from "@/lib/env";

const schema = z
  .object({
    // Empty keys (as copied from .env.example) count as unset.
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    // The EU cloud is https://cloud.langfuse.com (the SDK default when unset).
    LANGFUSE_BASE_URL: z.url().optional(),
  })
  .refine(
    (env) =>
      Boolean(env.LANGFUSE_PUBLIC_KEY) === Boolean(env.LANGFUSE_SECRET_KEY),
    {
      path: ["LANGFUSE_SECRET_KEY"],
      message:
        "set both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY, or neither",
    },
  );

/**
 * Whether Langfuse keys are set. Without them, tracing and eval uploads are
 * skipped (local development without keys, tests, CI).
 */
export function isLangfuseConfigured(): boolean {
  const env = parseEnv(schema, process.env);
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}
