-- The embedding of a chunk's markdown (#58), so later steps can search chunks
-- by meaning. 3072 is the output size of the `embed` task's model
-- (google/gemini-embedding-2, AI_TASKS in src/lib/ai/models.ts); changing the
-- model means re-embedding and a new column size. Null until the parse's
-- embed step has stored it. Only the workflow (service role) writes it.
--
-- No index yet: pgvector indexes `vector` up to 2000 dimensions; the
-- retrieval ticket picks one (for example halfvec) when it searches.
alter table public.chunks add column embedding extensions.vector(3072);

comment on column public.chunks.embedding is 'Embedding of the chunk markdown (task embed, 3072 dimensions). Null until embedded.';
