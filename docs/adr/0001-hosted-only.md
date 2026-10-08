# Hosted only, no self-hosted version

**Context.** A local version for end users would need users to bring their own API keys, a second auth and storage path, and its own documentation and tests. [VISION.md](../../VISION.md) requires accounts, usage metering and limits from the start, and AI cost is the main cost driver, so the product assumes one system that we operate. Non-technical students would not clone a repository, and local models are not good enough for math tutoring.

**Decision.** Ship one hosted product. Make local development excellent instead: cloning the repository and running Supabase locally starts the full stack.

**Consequences.** One code path for auth, storage and AI. Self-hosting can be reconsidered if a real need appears.
