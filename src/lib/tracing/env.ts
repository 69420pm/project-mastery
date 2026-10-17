import { z } from "zod";
import { parseEnv } from "@/lib/env";

const schema = z
  .object({
    // Empty keys (as copied from .env.example) count as unset.
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    // The EU cloud is https://cloud.langfuse.com (the SDK default when unset).
    LANGFUSE_BASE_URL: z.url().optional(),
    AI_PROVIDER: z.string().optional(),
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

/**
 * Whether AI calls are traced: Langfuse keys are set and the calls are real.
 * The mock provider's replies are not traced; they filled most of the free
 * plan's units with calls that say nothing about the AI.
 */
export function isTracingEnabled(): boolean {
  return (
    isLangfuseConfigured() &&
    parseEnv(schema, process.env).AI_PROVIDER !== "mock"
  );
}

/**
 * The Langfuse environment traces are filed under: an explicit
 * `LANGFUSE_TRACING_ENVIRONMENT`, else the Vercel environment (`production`,
 * `preview`), else `development`.
 */
export function getTracingEnvironment(): string {
  return (
    process.env.LANGFUSE_TRACING_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    "development"
  );
}
