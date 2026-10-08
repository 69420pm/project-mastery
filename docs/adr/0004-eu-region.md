# EU region

**Context.** The first users are university students in the EU, and course materials and learning data are personal data under the GDPR.

**Decision.** Host Supabase in Frankfurt and run Vercel functions in `fra1`, next to the database. Vercel's default region is in the US, so the region is set explicitly in `vercel.json`.

**Consequences.** Low latency between app and database, and personal data stored in the EU. Production AI requests must go to providers that do not train on or retain the data (see [ADR 0006](0006-ai-cost.md)).
