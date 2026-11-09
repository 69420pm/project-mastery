import "server-only";
import { z } from "zod";
import { optional, parseEnv } from "@/lib/env";

const schema = z.object({
  // The shared demo account that `/demo` signs visitors into. Both unset or
  // empty, as copied from .env.example, turn the demo link off.
  DEMO_EMAIL: optional(z.email()),
  DEMO_PASSWORD: optional(z.string().min(1)),
});

/** The demo account's credentials, or undefined when the demo is off. */
export function getDemoCredentials():
  { email: string; password: string } | undefined {
  const { DEMO_EMAIL, DEMO_PASSWORD } = parseEnv(schema, process.env);
  if (!DEMO_EMAIL || !DEMO_PASSWORD) return undefined;
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD };
}
