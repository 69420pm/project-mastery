-- Assumptions as text (#249 slice 3). What a KC assumes and no KC of the
-- Course means is no longer a KC without sources: it stays on the assuming
-- KC as text, in `kcs.assumes`. A KC is retired as soon as its sources are
-- gone. The live KCs without sources are deleted, and every extraction is
-- matched again on the next Update map, so their names come back as text.

alter table public.kcs
  add column assumes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(assumes) = 'array');

comment on column public.kcs.assumes is 'What the KC assumes that no KC of the Course means: [{ name, description }], unique by name. The build matches an entry again when it stores new KCs near it.';

delete from public.kcs as k
where k.retired_at is null
  and not exists (select 1 from public.kc_sources as s where s.kc_id = k.id);

update public.chapter_extractions
set assumes_matched = false
where kc_ids is not null;

-- Adds Prerequisites, adds what KCs assume as text and removes the text
-- entries that were matched, while the Course's build is `building`, and
-- marks the given unit extractions matched, in one transaction; false,
-- writing nothing, otherwise.
-- p_prerequisites: [{ from, to }] KC ids; links already stored are skipped.
-- p_assumes: [{ kc, name, description }] entries to add; a name the KC
-- already assumes (ignoring case and outer spaces) is skipped.
-- p_matched: [{ kc, name }] entries to remove, by name the same way.
drop function public.store_assumed_prerequisites(uuid, jsonb, jsonb, uuid[]);

create function public.store_assumed_prerequisites(
  p_course_id uuid,
  p_prerequisites jsonb,
  p_assumes jsonb,
  p_matched jsonb,
  p_extraction_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
  select v_owner, p_course_id, f.id, t.id
  from jsonb_array_elements(p_prerequisites) as l (value)
  join public.kcs as f
    on f.id = (l.value ->> 'from')::uuid and f.course_id = p_course_id
  join public.kcs as t
    on t.id = (l.value ->> 'to')::uuid and t.course_id = p_course_id
  where f.id <> t.id
  on conflict (from_kc, to_kc) do nothing;

  update public.kcs as k
  set assumes = coalesce((
    select jsonb_agg(e.value order by e.ord)
    from jsonb_array_elements(k.assumes) with ordinality as e (value, ord)
    where not exists (
      select 1
      from jsonb_array_elements(p_matched) as m (value)
      where (m.value ->> 'kc')::uuid = k.id
        and lower(btrim(m.value ->> 'name')) = lower(btrim(e.value ->> 'name'))
    )
  ), '[]'::jsonb)
  where k.course_id = p_course_id
    and k.id in (
      select (m.value ->> 'kc')::uuid from jsonb_array_elements(p_matched) as m (value)
    );

  with incoming as (
    select distinct on ((a.value ->> 'kc')::uuid, lower(btrim(a.value ->> 'name')))
      (a.value ->> 'kc')::uuid as kc_id,
      btrim(a.value ->> 'name') as name,
      a.value ->> 'description' as description,
      a.ord
    from jsonb_array_elements(p_assumes) with ordinality as a (value, ord)
    order by (a.value ->> 'kc')::uuid, lower(btrim(a.value ->> 'name')), a.ord
  ),
  added as (
    select i.kc_id,
      jsonb_agg(
        jsonb_build_object('name', i.name, 'description', i.description)
        order by i.ord
      ) as entries
    from incoming as i
    join public.kcs as s on s.id = i.kc_id and s.course_id = p_course_id
    where not exists (
      select 1
      from jsonb_array_elements(s.assumes) as e (value)
      where lower(btrim(e.value ->> 'name')) = lower(i.name)
    )
    group by i.kc_id
  )
  update public.kcs as k
  set assumes = k.assumes || added.entries
  from added
  where k.id = added.kc_id;

  update public.chapter_extractions
  set assumes_matched = true
  where course_id = p_course_id and id = any (p_extraction_ids);

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_assumed_prerequisites(uuid, jsonb, jsonb, jsonb, uuid[]) is
  'Stores the Prerequisites matched from what KCs assume, keeps the unmatched names on their KCs as text, removes the names matched again, and marks their unit extractions matched, while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_assumed_prerequisites(uuid, jsonb, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.store_assumed_prerequisites(uuid, jsonb, jsonb, jsonb, uuid[])
  to service_role;

-- Retires the Course's live KCs whose sources are all gone. Retired KCs
-- leave their Topic. Returns how many it retired.
create or replace function public.retire_unsourced_kcs(p_course_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_retired integer;
begin
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
  'Retires the Course''s KCs whose sources are all gone and takes them out of their Topics. Build workflow (service role) only.';
