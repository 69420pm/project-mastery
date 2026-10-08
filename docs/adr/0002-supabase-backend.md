# Supabase as the backend platform

**Context.** The app needs Postgres, authentication, file storage for several PDFs per user, and vector search for grounded answers. Running separate services for each adds accounts, configuration and failure modes for a small team.

**Decision.** Use Supabase for Postgres (with pgvector), Auth and Storage.

**Consequences.** One platform, one local emulator, one permission model for rows and files. The free plan has 1 GB of file storage, a 50 MB upload limit, and pauses projects after 7 days without activity, so the public demo needs a scheduled keep-alive and real usage needs the Pro plan.
