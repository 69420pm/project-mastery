import type { ReviewFinding } from "@/features/knowledge-map";

/**
 * How the Brief asks a Finding: its text, a follow-up for a solution that
 * does not match, and its sources as "<Material> p. N".
 */
export function findingQuestion({ kind, text, sources }: ReviewFinding) {
  const question =
    kind === "solution_mismatch" ? `${text} Which is right?` : text;
  return sources.length > 0
    ? `${question}\n\nSources: ${sources.join(", ")}`
    : question;
}

/**
 * The Finding the Brief is asking, and the one to ask after it. The asked
 * one is the first asked; without one, the first open one is asked next.
 */
export function reviewQueue(findings: ReviewFinding[]) {
  const asking = findings.find(({ asked }) => asked) ?? findings[0] ?? null;
  const next = findings.find((finding) => finding !== asking) ?? null;
  return { asking, next };
}
