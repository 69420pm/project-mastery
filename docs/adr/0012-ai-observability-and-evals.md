# Observability and quality of AI behavior

**Context.** The AI's most important behavior is pedagogical: asking before telling, grounding answers in the course. An AI that starts handing out solutions breaks the first principle of [VISION.md](../../VISION.md), and no unit test catches that.

**Decision.** Trace every AI call with Langfuse and keep evaluation datasets for key prompts, run on demand and before prompt or model changes. Report errors to Sentry, product analytics to PostHog, and send auth emails through Resend, since Supabase's built-in email is only meant for testing.

**Consequences.** Prompt and model changes are checked against evals like code changes are checked against tests.
