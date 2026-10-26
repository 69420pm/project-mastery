-- Mock grading, the Results session and exam results (#186). The
-- `gradeMock` workflow (service role) grades a submitted Mock exam per item
-- and makes it `graded`; Students only read what it writes.

-- Attempts -------------------------------------------------------------------

-- `mock` grades a Mock exam's item: it schedules like `learn`. `retry` is a
-- Results session's question on a corrected KC: it never schedules, like
-- `pre`.
alter table public.attempts drop constraint attempts_kind_check;
alter table public.attempts
  add constraint attempts_kind_check check (kind in ('pre', 'learn', 'mock', 'retry'));

-- Mock exams -----------------------------------------------------------------

alter table public.mock_exams drop constraint mock_exams_status_check;
alter table public.mock_exams
  add constraint mock_exams_status_check check (
    status in ('assembling', 'ready', 'in_progress', 'submitted', 'graded', 'failed')
  ),
  -- The points awarded over its graded items; null until graded.
  add column score numeric check (score >= 0),
  -- The mean squared gap between each graded item's predicted success and
  -- its share of points; null until graded, or when no item was graded.
  add column brier numeric check (brier between 0 and 1),
  -- When its grading workflow last started; the page starts it again after
  -- an hour.
  add column grading_started_at timestamptz,
  add column graded_at timestamptz,
  add constraint mock_exams_graded_check check ((status = 'graded') = (graded_at is not null));

alter table public.mock_items
  -- Points awarded in steps of 0.5; null until graded, and when grading
  -- failed.
  add column points_awarded numeric check (
    points_awarded >= 0 and points_awarded <= points and points_awarded * 2 = floor(points_awarded * 2)
  ),
  -- The grading's steps: [{ points, reason }].
  add column steps jsonb check (jsonb_typeof(steps) = 'array'),
  -- The final value against the key; null when not checked.
  add column "check" text check ("check" in ('match', 'mismatch')),
  -- When grading finished with it, graded or failed: a failed item has no
  -- points.
  add column graded_at timestamptz,
  add constraint mock_items_points_graded_check check (points_awarded is null or graded_at is not null);

-- As before, and grading starts with the submit: the caller then starts the
-- workflow.
create or replace function public.submit_mock_exam(p_mock_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_at timestamptz;
begin
  update public.mock_exams m
  set status = 'submitted',
    submitted_at = least(now(), m.started_at + make_interval(mins => m.duration_minutes + 1)),
    grading_started_at = now()
  where m.id = p_mock_id
    and m.owner = (select auth.uid())
    and m.status = 'in_progress'
  returning m.session_id, m.submitted_at into v_session, v_at;
  if not found then
    return false;
  end if;

  update public.study_sessions s
  set ended_at = v_at
  where s.id = v_session and s.ended_at is null;
  return true;
end;
$$;

comment on function public.submit_mock_exam(uuid) is 'Submits the caller''s mock in progress, ends its session and marks its grading started; false when it is not theirs or not in progress.';

-- Marks the grading of the caller's submitted mock started again when it
-- never started or started over an hour ago; true when it did, and the
-- caller then starts the workflow.
create function public.restart_mock_grading(p_mock_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with restarted as (
    update public.mock_exams m
    set grading_started_at = now()
    where m.id = p_mock_id
      and m.owner = (select auth.uid())
      and m.status = 'submitted'
      and (m.grading_started_at is null or m.grading_started_at < now() - interval '1 hour')
    returning m.id
  )
  select exists (select 1 from restarted);
$$;

comment on function public.restart_mock_grading(uuid) is 'Marks the grading of the caller''s submitted mock started when it never started or started over an hour ago; true when it did.';

revoke execute on function public.restart_mock_grading(uuid) from public, anon;
grant execute on function public.restart_mock_grading(uuid) to authenticated;

-- Results sessions -----------------------------------------------------------

-- The graded mock a `results` session goes through.
alter table public.study_sessions
  add column mock_id uuid references public.mock_exams (id) on delete set null;

create index study_sessions_mock_id_idx on public.study_sessions (mock_id);

-- Exam results ---------------------------------------------------------------

-- The grade a Student got in a Course's real exam, once per exam date; a
-- skipped question stores a null grade.
create table public.exam_results (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  exam_date date not null,
  grade text check (char_length(grade) between 1 and 50),
  created_at timestamptz not null default now(),
  unique (course_id, exam_date)
);

comment on table public.exam_results is 'A Student''s grade in a Course''s real exam, per exam date; null when skipped. Insert-only.';

create index exam_results_owner_idx on public.exam_results (owner);

alter table public.exam_results enable row level security;

create policy "Students can read their own exam results"
on public.exam_results for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can record exam results of their own Courses"
on public.exam_results for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.courses c
    where c.id = exam_results.course_id and c.owner = (select auth.uid())
  )
);

revoke all on table public.exam_results from anon, authenticated;
grant select on table public.exam_results to authenticated;
grant insert (course_id, exam_date, grade) on table public.exam_results to authenticated;
