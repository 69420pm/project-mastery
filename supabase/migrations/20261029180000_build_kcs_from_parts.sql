-- Build state, Course order and KCs (#225, slice 9 of #222): the build
-- extracts KCs per teaching Part, remembers each extraction, merges new KCs
-- with alike ones by their vectors, and retires KCs whose sources are gone
-- instead of deleting them. Materials get a Course order, and a build
-- without a heartbeat for 30 minutes counts as failed.

-- The old build's record of processed chunks: Parts and their extractions
-- replace it.
drop table public.knowledge_map_chunks;

-- Course order --------------------------------------------------------------

-- Orders "Lecture 2" before "Lecture 10".
create collation public.natural (provider = icu, locale = 'und-u-kn-true');

-- -1 until `place_material` places the Material on insert.
alter table public.materials add column position integer not null default -1;

-- Existing Materials: numbered ones by their names in natural order, then
-- the others by upload.
update public.materials as m
set position = o.rank - 1
from (
  select
    id,
    row_number() over (
      partition by course_id
      order by
        (name ~ '\d') desc,
        case when name ~ '\d' then name collate public.natural end,
        created_at,
        id
    ) as rank
  from public.materials
) as o
where o.id = m.id;

alter table public.materials
  add constraint materials_position_check check (position >= 0),
  add constraint materials_course_id_position_key
    unique (course_id, position) deferrable initially deferred;

comment on column public.materials.position is 'The Material''s place in Course order, 0-based. Set on upload by the numbers in its name, moved by the Student on the Materials page.';

-- Places a new Material in Course order: a numbered one before the first
-- numbered Material whose name comes after it in natural order, else after
-- the last numbered one; an unnumbered one last. Later Materials move down.
-- Security definer, since Students may update only a Material's name; it
-- touches only the new Material's Course, whose insert Row Level Security
-- still checks.
create function public.place_material()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position integer;
begin
  if new.position >= 0 then
    return new;
  end if;
  -- One upload at a time per Course.
  perform pg_advisory_xact_lock(hashtextextended(new.course_id::text, 0));

  if new.name ~ '\d' then
    select min(m.position) into v_position
    from public.materials as m
    where m.course_id = new.course_id
      and m.name ~ '\d'
      and (m.name collate public.natural) > (new.name collate public.natural);
    if v_position is null then
      select coalesce(max(m.position) + 1, 0) into v_position
      from public.materials as m
      where m.course_id = new.course_id and m.name ~ '\d';
    end if;
  else
    select coalesce(max(m.position) + 1, 0) into v_position
    from public.materials as m
    where m.course_id = new.course_id;
  end if;

  update public.materials
  set position = position + 1
  where course_id = new.course_id and position >= v_position;
  new.position := v_position;
  return new;
end;
$$;

revoke execute on function public.place_material() from public, anon, authenticated;

create trigger materials_place
before insert on public.materials
for each row execute function public.place_material();

-- Moves the caller's Material one place up (earlier) or down in Course
-- order, swapping it with its neighbour. False when it is not theirs or
-- has no neighbour that way.
create function public.move_material(p_material_id uuid, p_direction text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_position integer;
  v_other uuid;
  v_other_position integer;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'direction must be up or down';
  end if;
  select course_id into v_course_id
  from public.materials
  where id = p_material_id and owner = (select auth.uid());
  if not found then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_course_id::text, 0));
  select position into v_position from public.materials where id = p_material_id;

  select id, position into v_other, v_other_position
  from public.materials
  where course_id = v_course_id
    and case when p_direction = 'up' then position < v_position else position > v_position end
  order by case when p_direction = 'up' then -position else position end
  limit 1;
  if not found then
    return false;
  end if;

  update public.materials
  set position = case when id = p_material_id then v_other_position else v_position end
  where id in (p_material_id, v_other);
  return true;
end;
$$;

comment on function public.move_material(uuid, text) is 'Moves the caller''s Material one place up or down in Course order; true when it moved.';

revoke execute on function public.move_material(uuid, text) from public, anon;
grant execute on function public.move_material(uuid, text) to authenticated;

-- The build's lease -----------------------------------------------------------

alter table public.knowledge_map_builds
  add column heartbeat_at timestamptz not null default now();

comment on column public.knowledge_map_builds.heartbeat_at is 'When a build step or queue_knowledge_map_build last touched the build. A building build untouched for 30 minutes counts as failed.';

-- As before, but a build without a heartbeat for 30 minutes no longer
-- holds a new one back. Queueing sets the heartbeat.
create or replace function public.queue_knowledge_map_build(course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with stopped as (
    update public.materials as m
    set parse_status = 'failed', parse_failure = 'The parse stopped. Parse again.'
    where m.course_id = queue_knowledge_map_build.course_id
      and m.owner = (select auth.uid())
      and m.parse_status in ('queued', 'parsing')
      and m.heartbeat_at < now() - interval '30 minutes'
    returning m.id
  ),
  course as (
    select c.id, c.owner
    from public.courses as c
    where c.id = queue_knowledge_map_build.course_id
      and c.owner = (select auth.uid())
      and exists (
        select 1 from public.materials as m
        where m.course_id = c.id and m.parse_status = 'parsed'
      )
      and not exists (
        select 1 from public.materials as m
        where m.course_id = c.id
          and m.parse_status in ('queued', 'parsing')
          and m.id not in (select id from stopped)
      )
  ),
  queued as (
    insert into public.knowledge_map_builds as b (course_id, owner, status)
    select id, owner, 'building' from course
    on conflict (course_id) do update
    set status = 'building', failure_reason = null, started_at = now(),
      heartbeat_at = now()
    where b.status <> 'building'
      or b.heartbeat_at < now() - interval '30 minutes'
    returning b.course_id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_knowledge_map_build(uuid) is 'Starts a Knowledge map build of the caller''s Course if none is running (a build without a heartbeat for 30 minutes is not), a Material is parsed and none is queued or parsing; a queued or parsing Material without a heartbeat for 30 minutes is marked failed first. True when it started one.';

-- Extractions ---------------------------------------------------------------

-- What the extraction call of a teaching Part gave, checked in code, so a
-- Part whose content is unchanged is not called again.
create table public.part_extractions (
  part_id uuid primary key references public.parts (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  -- The Part's content_hash when it was extracted.
  content_hash text not null check (char_length(content_hash) = 64),
  -- { kcs: [{ name, description, type, chunkIds, assumes, embedding }],
  -- prerequisites: [{ from, to }] } with chunk ids and KC indexes; the
  -- embeddings go once the KCs are stored.
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  -- The stored KC each extracted KC became, in output order; null until the
  -- build stored them.
  kc_ids uuid[],
  created_at timestamptz not null default now()
);

comment on table public.part_extractions is 'The KCs and Prerequisites the build extracted from a teaching Part, kept while the Part''s content is unchanged.';

create index part_extractions_owner_idx on public.part_extractions (owner);
create index part_extractions_course_id_idx on public.part_extractions (course_id);

alter table public.part_extractions enable row level security;

create policy "Students can read their own part extractions"
on public.part_extractions for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.part_extractions from anon, authenticated;
grant select on table public.part_extractions to authenticated;

-- KC vectors and retired KCs --------------------------------------------------

alter table public.kcs
  add column embedding extensions.vector(2048),
  add column retired_at timestamptz;

comment on column public.kcs.embedding is 'The vector of "name: description" (task embed), stored once per KC.';
comment on column public.kcs.retired_at is 'When the KC lost its last source. A retired KC is out of the map, its Topic, the plan and Priority, and keeps its Attempts; an alike new KC revives it.';

-- A retired KC needs no Big idea, so a Big idea can go while one points
-- at it.
alter table public.kcs alter column big_idea_id drop not null;
alter table public.kcs drop constraint kcs_big_idea_id_fkey;
alter table public.kcs
  add constraint kcs_big_idea_id_fkey foreign key (big_idea_id)
    references public.big_ideas (id) on delete set null,
  add constraint kcs_big_idea_check check (retired_at is not null or big_idea_id is not null);

-- The Course's KCs with a vector nearest to `p_embedding` by cosine
-- similarity, most alike first: the live ones, or with `p_retired` the
-- retired ones. An exact scan without an index: pgvector's HNSW index stops
-- at 2,000 dimensions, and a Course holds a few thousand KCs at most.
-- p_embedding is the vector's text form, such as "[0.1,0.2]".
create function public.match_kcs(
  p_course_id uuid,
  p_embedding text,
  p_count integer,
  p_retired boolean default false
)
returns table (id uuid, similarity double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    k.id,
    (1 - (k.embedding operator(extensions.<=>) p_embedding::extensions.vector))::double precision
  from public.kcs as k
  where k.course_id = p_course_id
    and k.embedding is not null
    and (k.retired_at is not null) = p_retired
  order by k.embedding operator(extensions.<=>) p_embedding::extensions.vector, k.id
  limit greatest(p_count, 0);
$$;

comment on function public.match_kcs(uuid, text, integer, boolean) is
  'The Course''s live (or retired) KCs nearest to an embedding by cosine similarity. Build workflow (service role) only.';

revoke execute on function public.match_kcs(uuid, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.match_kcs(uuid, text, integer, boolean)
  to service_role;

-- Retires the Course's live KCs without a source: they leave their Topic.
-- Returns how many it retired.
create function public.retire_unsourced_kcs(p_course_id uuid)
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

revoke execute on function public.retire_unsourced_kcs(uuid) from public, anon, authenticated;
grant execute on function public.retire_unsourced_kcs(uuid) to service_role;

-- Stores the KCs of consolidated Part extractions in one transaction, while
-- the Course's build is `building`; false, writing nothing, otherwise.
--
-- p_kcs: [{ id, new, name, description, type, bigIdea, embedding, sources }].
-- A `new` KC is inserted after the Course's KCs, in the Big idea named
-- `bigIdea` (added at the end when missing), with its vector; any other is
-- a stored KC that gains `sources`, and a retired one comes back in the Big
-- idea `bigIdea`. Sources whose chunk is gone are skipped.
-- p_prerequisites: [{ from, to }] KC ids; links already stored are skipped.
-- p_parts: [{ partId, kcIds }]: the stored KC of each extracted KC, which
-- marks the extraction stored and drops its embeddings.
-- Runs as its caller: only the service role may call it.
create function public.store_part_kcs(
  p_course_id uuid,
  p_kcs jsonb,
  p_prerequisites jsonb,
  p_parts jsonb
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

  insert into public.big_ideas (owner, course_id, name, description, position)
  select
    v_owner, p_course_id, n.name, n.name,
    coalesce(
      (select max(b.position) + 1 from public.big_ideas as b where b.course_id = p_course_id),
      0
    ) + (row_number() over (order by n.first)) - 1
  from (
    select k.value ->> 'bigIdea' as name, min(k.ord) as first
    from jsonb_array_elements(p_kcs) with ordinality as k (value, ord)
    where k.value ->> 'bigIdea' is not null
    group by k.value ->> 'bigIdea'
  ) as n
  where not exists (
    select 1 from public.big_ideas as b
    where b.course_id = p_course_id and b.name = n.name
  );

  select coalesce(max(position) + 1, 0) into v_position
  from public.kcs
  where course_id = p_course_id;

  insert into public.kcs (
    id, owner, course_id, big_idea_id, name, description, type, origin,
    position, embedding
  )
  select
    (k.value ->> 'id')::uuid, v_owner, p_course_id,
    (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = k.value ->> 'bigIdea'
      order by b.position limit 1
    ),
    k.value ->> 'name', k.value ->> 'description', k.value ->> 'type', 'content',
    v_position + (row_number() over (order by k.ord)) - 1,
    (k.value ->> 'embedding')::extensions.vector
  from jsonb_array_elements(p_kcs) with ordinality as k (value, ord)
  where (k.value ->> 'new')::boolean;

  update public.kcs as k
  set retired_at = null,
    big_idea_id = (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = r.value ->> 'bigIdea'
      order by b.position limit 1
    )
  from jsonb_array_elements(p_kcs) as r (value)
  where not (r.value ->> 'new')::boolean
    and k.id = (r.value ->> 'id')::uuid
    and k.course_id = p_course_id
    and k.retired_at is not null;

  insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
  select distinct kc.id, c.id, v_owner, p_course_id
  from jsonb_array_elements(p_kcs) as k (value)
  cross join jsonb_array_elements_text(k.value -> 'sources') as s (chunk_id)
  join public.kcs as kc
    on kc.id = (k.value ->> 'id')::uuid and kc.course_id = p_course_id
  join public.chunks as c
    on c.id = s.chunk_id::uuid and c.course_id = p_course_id
  on conflict (kc_id, chunk_id) do nothing;

  insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
  select v_owner, p_course_id, f.id, t.id
  from jsonb_array_elements(p_prerequisites) as l (value)
  join public.kcs as f
    on f.id = (l.value ->> 'from')::uuid and f.course_id = p_course_id
  join public.kcs as t
    on t.id = (l.value ->> 'to')::uuid and t.course_id = p_course_id
  where f.id <> t.id
  on conflict (from_kc, to_kc) do nothing;

  update public.part_extractions as e
  set
    kc_ids = array(
      select x.id::uuid
      from jsonb_array_elements_text(p.value -> 'kcIds') with ordinality as x (id, ord)
      order by x.ord
    ),
    output = jsonb_set(
      e.output,
      '{kcs}',
      coalesce(
        (
          select jsonb_agg(x.value - 'embedding' order by x.ord)
          from jsonb_array_elements(e.output -> 'kcs') with ordinality as x (value, ord)
        ),
        '[]'::jsonb
      )
    )
  from jsonb_array_elements(p_parts) as p (value)
  where e.part_id = (p.value ->> 'partId')::uuid and e.course_id = p_course_id;

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_part_kcs(uuid, jsonb, jsonb, jsonb) is
  'Stores the KCs, sources and Prerequisites of consolidated Part extractions while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_part_kcs(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_part_kcs(uuid, jsonb, jsonb, jsonb)
  to service_role;

-- Ends a build: puts the Big ideas and live KCs in Course order and marks
-- the build built, in one transaction, while it is `building`; false
-- otherwise. p_big_ideas: Big idea names in order, each kept by its name or
-- added. p_kcs: [{ id, bigIdea }] in order; the Course's other KCs follow.
-- Big ideas left out go, and their Topics with them.
-- Runs as its caller: only the service role may call it.
create function public.arrange_knowledge_map(
  p_course_id uuid,
  p_big_ideas jsonb,
  p_kcs jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  -- Above every position, so renumbering never meets a taken one.
  v_offset constant integer := 1000000;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  update public.big_ideas set position = position + v_offset
  where course_id = p_course_id;
  insert into public.big_ideas (owner, course_id, name, description, position)
  select v_owner, p_course_id, n.name, n.name, v_offset * 2 + n.ord
  from jsonb_array_elements_text(p_big_ideas) with ordinality as n (name, ord)
  where not exists (
    select 1 from public.big_ideas as b
    where b.course_id = p_course_id and b.name = n.name
  );
  update public.big_ideas as b
  set position = n.ord - 1
  from jsonb_array_elements_text(p_big_ideas) with ordinality as n (name, ord)
  where b.course_id = p_course_id and b.name = n.name;

  update public.kcs set position = position + v_offset
  where course_id = p_course_id;
  update public.kcs as k
  set position = x.ord - 1,
    big_idea_id = (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = x.value ->> 'bigIdea'
    )
  from jsonb_array_elements(p_kcs) with ordinality as x (value, ord)
  where k.id = (x.value ->> 'id')::uuid and k.course_id = p_course_id;
  update public.kcs as k
  set position = jsonb_array_length(p_kcs) + r.rank - 1
  from (
    select id, row_number() over (order by position) as rank
    from public.kcs
    where course_id = p_course_id and position >= v_offset
  ) as r
  where k.id = r.id;

  delete from public.big_ideas
  where course_id = p_course_id and position >= v_offset;

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, finished_at = now(),
    heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.arrange_knowledge_map(uuid, jsonb, jsonb) is
  'Puts the Course''s Big ideas and KCs in Course order and marks the running build built. Build workflow (service role) only.';

revoke execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb)
  to service_role;
