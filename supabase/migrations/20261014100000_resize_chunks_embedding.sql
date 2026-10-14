-- The `embed` task moves from google/gemini-embedding-2 (3072 dimensions) to
-- cohere/embed-v5.0-fast, whose default output is 2048 dimensions (AI_TASKS in
-- src/lib/ai/models.ts). Vectors of different models are not comparable, so
-- the old embeddings are dropped; the parse's embed step fills a chunk's
-- column again when its Material is parsed again.
--
-- No index yet: pgvector indexes `vector` up to 2000 dimensions, so the
-- retrieval ticket indexes a halfvec cast (up to 4000) or fewer dimensions
-- when it searches.
alter table public.chunks drop column embedding;

alter table public.chunks add column embedding extensions.vector(2048);

comment on column public.chunks.embedding is 'Embedding of the chunk markdown (task embed, 2048 dimensions). Null until embedded.';
