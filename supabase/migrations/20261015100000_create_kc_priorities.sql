-- The Priority of each KC of a Course for the Student's exam (#86), and the
-- state of the Course's last priority run. Code computes a base from old
-- exams, Exercises and the prerequisite graph and multiplies it with a
-- multiplier (src/features/priorities/domain/priority.ts). Only the
-- `updatePriorities` workflow (service role) writes them, except
-- queue_priority_run and record_priority_run_start_failure; a Student reads
-- their own rows.

create table public.kc_priorities (
  kc_id uuid primary key references public.kcs (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  -- Base × multiplier; not clamped.
  priority numeric not null check (priority >= 0),
  multiplier numeric not null check (multiplier >= 0),
  -- Why the KC has this priority, one line each.
  reasons text[] not null default '{}'
);

comment on table public.kc_priorities is 'The Priority of a KC for the Student''s exam, with its multiplier and reasons. Written by replace_kc_priorities only.';

-- One row per Course whose priorities ever ran. No row: never ran.
create table public.priority_runs (
  course_id uuid primary key references public.courses (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('running', 'done', 'failed')),
  -- A short message for the Student when the run failed.
  failure_reason text check (char_length(failure_reason) between 1 and 300),
  -- When the run's input was read: set when a run is queued, and kept when
  -- it fails, so the next run waits for the next change.
  computed_at timestamptz not null default now(),
  -- When the model last adjusted the multipliers; null before.
  adjusted_at timestamptz,
  check ((status = 'failed') = (failure_reason is not null))
);

comment on table public.priority_runs is 'The state of a Course''s last priority run. Written by queue_priority_run, record_priority_run_start_failure and the priority workflow only.';

create index kc_priorities_course_id_idx on public.kc_priorities (course_id);
create index kc_priorities_owner_idx on public.kc_priorities (owner);
create index priority_runs_owner_idx on public.priority_runs (owner);

alter table public.kc_priorities enable row level security;
alter table public.priority_runs enable row level security;

create policy "Students can read their own KC priorities"
on public.kc_priorities for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own priority runs"
on public.priority_runs for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.kc_priorities from anon, authenticated;
revoke all on table public.priority_runs from anon, authenticated;
grant select on table public.kc_priorities to authenticated;
grant select on table public.priority_runs to authenticated;

-- Moves the signed-in Student's Course's priority run to `running` and says
-- whether it did: when the Course has a built map, no run is running, and
-- the run is stale: it never ran, or the map's last build, the Brief or a
-- Finding's answer is newer than `computed_at`. The conditional upsert lets
-- only one of two concurrent calls (two tabs) through, so the caller starts
-- one workflow.
create function public.queue_priority_run(course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with course as (
    select
      c.id, c.owner,
      greatest(
        b.finished_at,
        (select br.updated_at from public.briefs as br where br.course_id = c.id),
        (select max(f.answered_at) from public.findings as f where f.course_id = c.id)
      ) as changed_at
    from public.courses as c
    join public.knowledge_map_builds as b on b.course_id = c.id
    where c.id = queue_priority_run.course_id
      and c.owner = (select auth.uid())
      and b.finished_at is not null
  ),
  queued as (
    insert into public.priority_runs as r (course_id, owner, status, computed_at)
    select id, owner, 'running', now() from course
    on conflict (course_id) do update
    set status = 'running', failure_reason = null, computed_at = now()
    where r.status <> 'running'
      and r.computed_at < (select changed_at from course)
    returning r.course_id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_priority_run(uuid) is 'Starts a priority run of the caller''s Course if its map is built, none is running and the last one is older than the map, the Brief or a Finding answer; true when it did.';

-- Fails the signed-in Student's running priority run after the server's
-- `start()` of its workflow failed; true when it did.
create function public.record_priority_run_start_failure(course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with failed as (
    update public.priority_runs
    set status = 'failed', failure_reason = 'The priorities could not be computed.'
    where course_id = record_priority_run_start_failure.course_id
      and owner = (select auth.uid())
      and status = 'running'
    returning course_id
  )
  select exists (select 1 from failed);
$$;

comment on function public.record_priority_run_start_failure(uuid) is 'Fails the caller''s running priority run whose workflow could not start; true when it did.';

revoke execute on function public.queue_priority_run(uuid) from public, anon;
grant execute on function public.queue_priority_run(uuid) to authenticated;
revoke execute on function public.record_priority_run_start_failure(uuid) from public, anon;
grant execute on function public.record_priority_run_start_failure(uuid) to authenticated;

-- The priority workflow's write: in one transaction, while the Course's run
-- is `running`, it replaces the Course's KC priorities and marks the run
-- `done`. Returns false, writing nothing, when no run is running. Entries
-- whose KC is gone or belongs to another Course are skipped.
--
-- p_priorities: [{ kcId, priority, multiplier, reasons: [text] }]. Runs as
-- its caller: only the service role may call it.
create function public.replace_kc_priorities(
  p_course_id uuid,
  p_priorities jsonb
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
  from public.priority_runs
  where course_id = p_course_id and status = 'running'
  for update;
  if not found then
    return false;
  end if;

  delete from public.kc_priorities where course_id = p_course_id;

  insert into public.kc_priorities (kc_id, course_id, owner, priority, multiplier, reasons)
  select
    k.id, p_course_id, v_owner, (e.value ->> 'priority')::numeric,
    (e.value ->> 'multiplier')::numeric,
    coalesce(
      (select array_agg(r.value order by r.ord)
        from jsonb_array_elements_text(e.value -> 'reasons') with ordinality as r (value, ord)),
      '{}'
    )
  from jsonb_array_elements(p_priorities) as e (value)
  join public.kcs as k
    on k.id::text = e.value ->> 'kcId' and k.course_id = p_course_id
  on conflict (kc_id) do nothing;

  update public.priority_runs
  set status = 'done', failure_reason = null
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_kc_priorities(uuid, jsonb) is
  'Replaces a Course''s KC priorities and marks the running priority run done, in one transaction. Priority workflow (service role) only.';

revoke execute on function public.replace_kc_priorities(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_kc_priorities(uuid, jsonb)
  to service_role;
