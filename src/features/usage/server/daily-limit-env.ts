import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/env";

const dollars = "expected an amount in US dollars, like 0.50";

const schema = z.object({
  // The Daily limit per Student in US dollars: their AI spend since 00:00
  // UTC, priced from the price table (ADR 0006). Unset or empty, as copied
  // from .env.example, means no limit.
  AI_DAILY_LIMIT_USD: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number({ error: dollars }).nonnegative(dollars).optional(),
  ),
});

/**
 * The Daily limit per Student in US dollars, or undefined for no limit.
 * Validated at first use, so it needs no AI credentials.
 */
export function getDailyLimitUsd(): number | undefined {
  return parseEnv(schema, process.env).AI_DAILY_LIMIT_USD;
}
