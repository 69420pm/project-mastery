-- The tutor's searchMaterials tool (#181): the Course's embedded chunks by
-- cosine distance to a query embedding, nearest first. An exact scan, with
-- no index: a Course has at most a few thousand chunks.
--
-- Runs as its caller, so Row Level Security shows a Student only their own
-- chunks; p_course_id narrows them to one Course. p_embedding is the text form
-- of the vector, such as "[0.1,0.2]", as set_chunk_embeddings takes it.
-- Chunks without a vector are left out.
create function public.match_chunks(
  p_course_id uuid,
  p_embedding text,
  p_count integer
)
returns table (id uuid, distance double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    (c.embedding operator(extensions.<=>) p_embedding::extensions.vector)::double precision as distance
  from public.chunks as c
  where c.course_id = p_course_id
    and c.embedding is not null
  order by c.embedding operator(extensions.<=>) p_embedding::extensions.vector, c.id
  limit greatest(p_count, 0);
$$;

comment on function public.match_chunks(uuid, text, integer) is
  'The Course''s embedded chunks nearest to a query embedding by cosine distance, under the caller''s Row Level Security.';

revoke execute on function public.match_chunks(uuid, text, integer)
  from public, anon;
grant execute on function public.match_chunks(uuid, text, integer)
  to authenticated, service_role;
