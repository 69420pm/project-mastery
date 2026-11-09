-- Old exams teach nothing (#249): a Chapter the Student confirmed as an old
-- exam, and every Chapter below it, forms no teaching units. The KCs a
-- build took from the `content` chunks of such Chapters lose those sources,
-- and a KC left with none is retired as any KC without sources.

create or replace function public.retire_unsourced_kcs(p_course_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_retired integer;
begin
  with recursive exam_chapters as (
    select c.id
    from public.chapters as c
    where c.course_id = p_course_id and c.is_exam is true
    union
    select c.id
    from public.chapters as c
    join exam_chapters as e on c.parent_id = e.id
    where c.course_id = p_course_id
  )
  delete from public.kc_sources as s
  using public.chunks as ch
  where s.course_id = p_course_id
    and ch.id = s.chunk_id
    and ch.label = 'content'
    and ch.chapter_id in (select id from exam_chapters);

  update public.kcs as k
  set retired_at = now()
  where k.course_id = p_course_id
    and k.retired_at is null
    and not exists (select 1 from public.kc_sources as s where s.kc_id = k.id);
  get diagnostics v_retired = row_count;

  delete from public.topic_kcs as t
  using public.kcs as k
  where t.kc_id = k.id and k.course_id = p_course_id and k.retired_at is not null;
  return v_retired;
end;
$$;

comment on function public.retire_unsourced_kcs(uuid) is
  'Takes the sources in old exams'' content chunks from the Course''s KCs, retires the KCs whose sources are all gone and takes them out of their Topics. Build workflow (service role) only.';
