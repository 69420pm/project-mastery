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
    // Where model ids resolve: AI Gateway, the Gemini API directly for local
    // development without a card on file (ADR 0006), or deterministic mock
    // models for end-to-end tests of the running app.
    AI_PROVIDER: optional(z.enum(["gateway", "google", "mock"])).default(
      "gateway",
    ),
    // Local development authenticates with an AI Gateway API key. Deployments
    // on Vercel (VERCEL=1) authenticate through OIDC automatically, and
    // `vercel env pull` provides VERCEL_OIDC_TOKEN locally (valid for 12h).
    AI_GATEWAY_API_KEY: optional(z.string()),
    // Gemini API key from Google AI Studio, for AI_PROVIDER=google.
    GOOGLE_GENERATIVE_AI_API_KEY: optional(z.string()),
    VERCEL_OIDC_TOKEN: optional(z.string()),
    VERCEL: z.string().optional(),
    // Optional per-task model overrides, see src/lib/ai/models.ts.
    AI_MODEL_CHAT: modelId,
    AI_MODEL_TITLE: modelId,
    AI_MODEL_INGEST: modelId,
    AI_MODEL_EMBED: modelId,
    AI_MODEL_JUDGE: modelId,
  })
  .refine(
    (env) =>
      env.AI_PROVIDER !== "gateway" ||
      env.AI_GATEWAY_API_KEY ||
      env.VERCEL_OIDC_TOKEN ||
      env.VERCEL === "1",
    {
      path: ["AI_GATEWAY_API_KEY"],
      message:
        "required outside Vercel (create a key in the Vercel dashboard under AI Gateway, or run `vercel env pull` for an OIDC token)",
    },
  )
  .refine(
    (env) => env.AI_PROVIDER !== "google" || env.GOOGLE_GENERATIVE_AI_API_KEY,
    {
      path: ["GOOGLE_GENERATIVE_AI_API_KEY"],
      message:
        "required for AI_PROVIDER=google (create a key in Google AI Studio)",
    },
  )
  // The Gemini API free tier may not serve users in the EU and uses prompts
  // for training, so it stays on developer machines.
  .refine((env) => env.AI_PROVIDER !== "google" || env.VERCEL !== "1", {
    path: ["AI_PROVIDER"],
    message: "'google' is for local development only, use 'gateway' on Vercel",
  })
  // Mock replies on a deployment would look like a working AI to Students.
  .refine((env) => env.AI_PROVIDER !== "mock" || env.VERCEL !== "1", {
    path: ["AI_PROVIDER"],
    message: "'mock' is for end-to-end tests only, use 'gateway' on Vercel",
  });

export type AiEnv = z.infer<typeof schema>;

/**
 * Validates the AI environment at first use, so pages without AI calls (and
 * builds) work without a key.
 */
export function getAiEnv(): AiEnv {
  return parseEnv(schema, process.env);
}
