import { AgentError } from "./config";

/**
 * Test users that exist only in the local Supabase stack. `agent up` and
 * `agent reset` create them. Two users make it easy to check that one user
 * cannot see another's data.
 */
export const PERSONAS = {
  student: { email: "student@example.com", displayName: "Sam Student" },
  classmate: { email: "classmate@example.com", displayName: "Casey Classmate" },
} as const;

export type PersonaName = keyof typeof PERSONAS;

/** Local only: the stack's auth accepts it, nothing else does. */
export const PERSONA_PASSWORD = "agent-password-123";

export function persona(name: string) {
  if (!(name in PERSONAS)) {
    throw new AgentError(
      `Unknown persona "${name}". Use one of: ${Object.keys(PERSONAS).join(", ")}.`,
    );
  }
  return PERSONAS[name as PersonaName];
}

/** Who `sql --as` runs as: anonymous, a persona, or any user by email. */
export function sqlIdentity(
  value: string,
): { role: "anon" } | { role: "authenticated"; email: string } {
  if (value === "anon") return { role: "anon" };
  if (value.includes("@")) return { role: "authenticated", email: value };
  return { role: "authenticated", email: persona(value).email };
}
