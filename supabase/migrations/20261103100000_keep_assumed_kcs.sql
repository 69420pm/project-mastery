-- KCs without sources (#236). What the Materials assume but never explain
-- becomes a KC without rows in `kc_sources`: the Prerequisite check stores
-- it with the links to the KCs that assume it, and a build retires a KC
-- without sources only when no live KC builds on it.

-- Adds the new KCs, revives retired ones and adds Prerequisites while the
-- Course's build is `building`, and marks the given unit extractions
-- matched, in one transaction; false, writing nothing, otherwise.
-- p_kcs: [{ id, new: true, name, description, embedding }] for a new KC
-- (origin `content`, after the Course's other KCs), [{ id, new: false }]
-- for a retired KC it revives.
-- p_prerequisites: [{ from, to }] KC ids; links already stored are skipped.
drop function public.store_assumed_prerequisites(uuid, jsonb, uuid[]);

create function public.store_assumed_prerequisites(
  p_course_id uuid,
  p_kcs jsonb,
  p_prerequisites jsonb,
  p_extraction_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_position integer;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  select coalesce(max(position) + 1, 0) into v_position
  from public.kcs
  where course_id = p_course_id;

  insert into public.kcs (
    id, owner, course_id, name, description, origin, position, embedding
  )
  select
    (k.value ->> 'id')::uuid, v_owner, p_course_id,
    k.value ->> 'name', k.value ->> 'description', 'content',
    v_position + (row_number() over (order by k.ord)) - 1,
    (k.value ->> 'embedding')::extensions.vector
  from jsonb_array_elements(p_kcs) with ordinality as k (value, ord)
  where (k.value ->> 'new')::boolean;

  update public.kcs as k
  set retired_at = null
  from jsonb_array_elements(p_kcs) as r (value)
  where not (r.value ->> 'new')::boolean
    and k.id = (r.value ->> 'id')::uuid
    and k.course_id = p_course_id
    and k.retired_at is not null;

  insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
  select v_owner, p_course_id, f.id, t.id
  from jsonb_array_elements(p_prerequisites) as l (value)
  join public.kcs as f
    on f.id = (l.value ->> 'from')::uuid and f.course_id = p_course_id
  join public.kcs as t
    on t.id = (l.value ->> 'to')::uuid and t.course_id = p_course_id
  where f.id <> t.id
  on conflict (from_kc, to_kc) do nothing;

  update public.chapter_extractions
  set assumes_matched = true
  where course_id = p_course_id and id = any (p_extraction_ids);

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_assumed_prerequisites(uuid, jsonb, jsonb, uuid[]) is
  'Stores the KCs without sources and the Prerequisites matched from what KCs assume, and marks their unit extractions matched, while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_assumed_prerequisites(uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.store_assumed_prerequisites(uuid, jsonb, jsonb, uuid[])
  to service_role;

-- Retires the Course's live KCs without a source that no live KC builds
-- on, repeating until nothing changes, so a chain of them goes at once and
-- one that a live KC builds on stays. Retired KCs leave their Topic.
-- Returns how many it retired.
create or replace function public.retire_unsourced_kcs(p_course_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_retired integer := 0;
  v_round integer;
begin
  loop
    update public.kcs as k
    set retired_at = now()
    where k.course_id = p_course_id
      and k.retired_at is null
      and not exists (select 1 from public.kc_sources as s where s.kc_id = k.id)
      and not exists (
        select 1
        from public.prerequisite_links as l
        join public.kcs as d on d.id = l.to_kc
        where l.from_kc = k.id and d.retired_at is null
      );
    get diagnostics v_round = row_count;
    exit when v_round = 0;
    v_retired := v_retired + v_round;
  end loop;

  delete from public.topic_kcs as t
  using public.kcs as k
  where t.kc_id = k.id and k.course_id = p_course_id and k.retired_at is not null;
  return v_retired;
end;
$$;

comment on function public.retire_unsourced_kcs(uuid) is
  'Retires the Course''s KCs without sources that no live KC builds on and takes them out of their Topics. Build workflow (service role) only.';

-- The extractions of teaching units were stored with `assumes` as names;
-- the next Update map extracts them again with descriptions.
update public.chapter_extractions
set content_hash = repeat('0', 64)
where kind = 'content';
