-- pgvector stores chunk embeddings for grounded answers (ARCHITECTURE.md,
-- decision 7). Supabase keeps extensions out of the exposed `public` schema.
create extension if not exists vector with schema extensions;
