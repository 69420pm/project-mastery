import { z } from "zod";
import { optional, parseEnv } from "@/lib/env";

const schema = z
  .object({
    LANGFUSE_PUBLIC_KEY: optional(z.string()),
    LANGFUSE_SECRET_KEY: optional(z.string()),
    // The EU cloud is https://cloud.langfuse.com (the SDK default when unset).
    LANGFUSE_BASE_URL: optional(z.url()),
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
  return hasKeys(parseEnv(schema, process.env));
}

function hasKeys(env: z.infer<typeof schema>): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

/**
 * Whether AI calls are traced: Langfuse keys are set and the calls are real.
 * The mock provider's replies are not traced; they filled most of the free
 * plan's units with calls that say nothing about the AI.
 */
export function isTracingEnabled(): boolean {
  const env = parseEnv(schema, process.env);
  return hasKeys(env) && env.AI_PROVIDER !== "mock";
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
