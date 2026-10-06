import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/env";

// Empty values (as copied from .env.example) count as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const modelId = optional(
  z
    .string()
    .regex(
      /^[\w.-]+\/[\w.:-]+$/,
      "expected a gateway model id like 'provider/model'",
    ),
);

const schema = z
  .object({
    // Local development authenticates with an AI Gateway API key. Deployments
    // on Vercel (VERCEL=1) authenticate through OIDC automatically, and
    // `vercel env pull` provides VERCEL_OIDC_TOKEN locally (valid for 12h).
    AI_GATEWAY_API_KEY: optional(z.string()),
    VERCEL_OIDC_TOKEN: optional(z.string()),
    VERCEL: z.string().optional(),
    // Optional per-task model overrides, see src/lib/ai/models.ts.
    AI_MODEL_TUTOR: modelId,
    AI_MODEL_INGEST: modelId,
    AI_MODEL_EMBED: modelId,
    AI_MODEL_JUDGE: modelId,
  })
  .refine(
    (env) =>
      env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || env.VERCEL === "1",
    {
      path: ["AI_GATEWAY_API_KEY"],
      message:
        "required outside Vercel (create a key in the Vercel dashboard under AI Gateway, or run `vercel env pull` for an OIDC token)",
    },
  );

export type AiEnv = z.infer<typeof schema>;

/**
 * Validates the AI environment at first use, so pages without AI calls (and
 * builds) work without a key.
 */
export function getAiEnv(): AiEnv {
  return parseEnv(schema, process.env);
}
