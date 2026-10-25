-- Tutoring M5b (#183): the generate workflow's run per Course. A Learn
-- session's start (Topic stock) or a Study session's end (review stock)
-- queues a run through `queue_problem_run`, which lets one run per Course
-- through at a time, as `queue_priority_run` does, so a trigger during a
-- run is dropped. The workflow reads which stock to plan from the row and
-- marks it done.

create table public.problem_runs (
  course_id uuid primary key references public.courses (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('running', 'done')),
  -- What the run plans: the stock of `topic_id`, or the review stock.
  stock text not null check (stock in ('topic', 'review')),
  topic_id uuid references public.topics (id) on delete set null,
  started_at timestamptz not null default now(),
  check (stock = 'topic' or topic_id is null)
);

comment on table public.problem_runs is 'The state of a Course''s last generate run. Written by queue_problem_run, release_problem_run and the generate workflow only.';

create index problem_runs_owner_idx on public.problem_runs (owner);
create index problem_runs_topic_id_idx on public.problem_runs (topic_id);

alter table public.problem_runs enable row level security;

create policy "Students can read their own problem runs"
on public.problem_runs for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.problem_runs from anon, authenticated;
grant select on table public.problem_runs to authenticated;

-- Moves the signed-in Student's Course's generate run to `running` for the
-- stock of `p_topic_id`, a Topic of the Course, or the review stock when it
-- is null, and says whether it did. A running run drops the call, unless it
-- started more than an hour ago: a run that died then no longer blocks the
-- Course. The conditional upsert lets one of two concurrent calls through.
create function public.queue_problem_run(p_course_id uuid, p_topic_id uuid default null)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with course as (
    select c.id, c.owner
    from public.courses as c
    where c.id = p_course_id
      and c.owner = (select auth.uid())
      and (
        p_topic_id is null
        or exists (
          select 1 from public.topics as t
          where t.id = p_topic_id and t.course_id = c.id
        )
      )
  ),
  queued as (
    insert into public.problem_runs as r (course_id, owner, status, stock, topic_id, started_at)
    select id, owner, 'running',
      case when p_topic_id is null then 'review' else 'topic' end,
      p_topic_id, now()
    from course
    on conflict (course_id) do update
    set status = 'running', stock = excluded.stock, topic_id = excluded.topic_id,
      started_at = now()
    where r.status <> 'running' or r.started_at < now() - interval '1 hour'
    returning r.course_id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_problem_run(uuid, uuid) is 'Starts a generate run of the caller''s Course for a Topic''s stock, or the review stock without one, unless one is running; true when it did.';

-- Ends the signed-in Student's running generate run after the server's
-- `start()` of its workflow failed; true when it did.
create function public.release_problem_run(p_course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with released as (
    update public.problem_runs
    set status = 'done'
    where course_id = p_course_id
      and owner = (select auth.uid())
      and status = 'running'
    returning course_id
  )
  select exists (select 1 from released);
$$;

comment on function public.release_problem_run(uuid) is 'Ends the caller''s running generate run whose workflow could not start; true when it did.';

revoke execute on function public.queue_problem_run(uuid, uuid) from public, anon;
grant execute on function public.queue_problem_run(uuid, uuid) to authenticated;
revoke execute on function public.release_problem_run(uuid) from public, anon;
grant execute on function public.release_problem_run(uuid) to authenticated;
