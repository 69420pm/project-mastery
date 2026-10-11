-- The parse workflow's write of a batch of chunk embeddings (#58), all or
-- nothing: a failed write leaves every chunk of the batch without a vector,
-- so a retry embeds the whole batch again instead of a part of it.
--
-- p_embeddings is a jsonb array of { "id": chunk id, "embedding": text form of
-- the vector, such as "[0.1,0.2]" }. Runs as its caller: only the service role
-- may call it.
create function public.set_chunk_embeddings(p_embeddings jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.chunks as c
  set embedding = e.embedding::extensions.vector
  from jsonb_to_recordset(p_embeddings) as e (id uuid, embedding text)
  where c.id = e.id;
$$;

comment on function public.set_chunk_embeddings(jsonb) is
  'Stores a batch of chunk embeddings in one transaction. Parse workflow (service role) only.';

revoke execute on function public.set_chunk_embeddings(jsonb)
  from public, anon, authenticated;
grant execute on function public.set_chunk_embeddings(jsonb) to service_role;
