-- Mock exams (#185). The Brief can reserve one old exam of the Course for
-- the final Mock exam: while the reservation is active, the tutor, problem
-- generation and the other mocks leave its Exercises and chunks out.

-- The reserved exam Material; null when none is reserved, or when the
-- Material was deleted.
alter table public.briefs
  add column reserved_exam_material_id uuid references public.materials (id) on delete set null,
  -- Whether the Student answered the reservation question, with an exam or
  -- with none.
  add column reserved_exam_answered boolean not null default false;

create index briefs_reserved_exam_material_id_idx on public.briefs (reserved_exam_material_id);

grant update (reserved_exam_material_id, reserved_exam_answered)
  on table public.briefs to authenticated;

-- A reserved Material must be an old exam of the Brief's own Course. Runs as
-- the caller, so Row Level Security hides another Student's Materials.
create function private.check_reserved_exam()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.reserved_exam_material_id is not null and not exists (
    select 1 from public.materials m
    where m.id = new.reserved_exam_material_id
      and m.course_id = new.course_id
      and m.is_exam is true
  ) then
    raise exception 'The reserved exam must be an old exam of the Course'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_reserved_exam() from public, anon, authenticated;

create trigger briefs_check_reserved_exam
before insert or update of reserved_exam_material_id on public.briefs
for each row execute function private.check_reserved_exam();

-- As before, and the fields may name `reserved_exam_material_id` and
-- `reserved_exam_answered`.
create or replace function public.save_brief(
  course_id uuid,
  fields jsonb default '{}',
  excluded_material_ids uuid[] default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.briefs b
  set
    exam_date = case when fields ? 'exam_date' then (fields ->> 'exam_date')::date else b.exam_date end,
    goal = case when fields ? 'goal' then fields ->> 'goal' else b.goal end,
    hours_per_week = case when fields ? 'hours_per_week' then (fields ->> 'hours_per_week')::numeric else b.hours_per_week end,
    question_style = case when fields ? 'question_style' then fields ->> 'question_style' else b.question_style end,
    open_book = case when fields ? 'open_book' then (fields ->> 'open_book')::boolean else b.open_book end,
    formula_sheet = case when fields ? 'formula_sheet' then (fields ->> 'formula_sheet')::boolean else b.formula_sheet end,
    calculator = case when fields ? 'calculator' then (fields ->> 'calculator')::boolean else b.calculator end,
    scope_confirmed = case when fields ? 'scope_confirmed' then (fields ->> 'scope_confirmed')::boolean else b.scope_confirmed end,
    reserved_exam_material_id = case when fields ? 'reserved_exam_material_id' then (fields ->> 'reserved_exam_material_id')::uuid else b.reserved_exam_material_id end,
    reserved_exam_answered = case when fields ? 'reserved_exam_answered' then (fields ->> 'reserved_exam_answered')::boolean else b.reserved_exam_answered end
  where b.course_id = save_brief.course_id;
  if not found then
    return false;
  end if;

  if excluded_material_ids is not null then
    delete from public.brief_excluded_materials e
    where e.course_id = save_brief.course_id;
    insert into public.brief_excluded_materials (course_id, material_id)
    select distinct save_brief.course_id, m.id
    from unnest(excluded_material_ids) as m (id);
  end if;
  return true;
end;
$$;

-- Mock exams ----------------------------------------------------------------

-- A timed Mock exam of a Course. `queue_mock_exam` inserts it `assembling`,
-- the `assembleMock` workflow (service role) fills its items and makes it
-- `ready` or `failed`. A Course has at most one open mock (assembling, ready
-- or in progress).
create table public.mock_exams (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  status text not null default 'assembling' check (
    status in ('assembling', 'ready', 'in_progress', 'submitted', 'failed')
  ),
  -- The reserved exam a final mock is; null for every other mock.
  reserved_material_id uuid references public.materials (id) on delete set null,
  -- The sum of its items' minutes; null until ready.
  duration_minutes smallint check (duration_minutes > 0),
  -- The sum of its items' points times their predicted success.
  predicted_score numeric check (predicted_score >= 0),
  session_id uuid references public.study_sessions (id) on delete set null,
  -- Assembly's progress: the missing Problems it generates, and how many
  -- it has finished.
  gaps_total smallint not null default 0 check (gaps_total >= 0),
  gaps_done smallint not null default 0 check (gaps_done between 0 and gaps_total),
  -- Why a failed mock failed.
  failure text check (char_length(failure) between 1 and 500),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  check ((status = 'failed') = (failure is not null)),
  check (status in ('assembling', 'failed') or duration_minutes is not null)
);

comment on table public.mock_exams is 'A Mock exam of a Course. Written by queue_mock_exam, release_mock_exam and the assembleMock workflow only.';

create unique index mock_exams_one_open_idx on public.mock_exams (course_id)
where status in ('assembling', 'ready', 'in_progress');
create index mock_exams_owner_idx on public.mock_exams (owner);
create index mock_exams_course_id_idx on public.mock_exams (course_id);
create index mock_exams_reserved_material_id_idx on public.mock_exams (reserved_material_id);
create index mock_exams_session_id_idx on public.mock_exams (session_id);

-- One task of a mock: an Exercise or a generated Problem, with a snapshot
-- of its statement, so a later map build cannot change a taken mock.
create table public.mock_items (
  id uuid primary key default gen_random_uuid(),
  mock_id uuid not null references public.mock_exams (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position >= 0),
  exercise_id uuid references public.exercises (id) on delete set null,
  problem_id uuid references public.problems (id) on delete set null,
  topic_id uuid references public.topics (id) on delete set null,
  prompt text not null check (char_length(prompt) between 1 and 20000),
  -- One point counts one minute.
  points smallint not null check (points > 0),
  -- The mean recall today of its KCs when it was assembled.
  predicted_success numeric not null check (predicted_success between 0 and 1),
  -- The Question it is asked as, once the mock starts.
  question_id uuid references public.questions (id) on delete set null,
  unique (mock_id, position),
  check (exercise_id is null or problem_id is null)
);

comment on table public.mock_items is 'A task of a Mock exam: an Exercise or a generated Problem. Written by the assembleMock workflow only.';

create index mock_items_owner_idx on public.mock_items (owner);
create index mock_items_exercise_id_idx on public.mock_items (exercise_id);
create index mock_items_problem_id_idx on public.mock_items (problem_id);
create index mock_items_topic_id_idx on public.mock_items (topic_id);
create index mock_items_question_id_idx on public.mock_items (question_id);

alter table public.mock_exams enable row level security;
alter table public.mock_items enable row level security;

create policy "Students can read their own mock exams"
on public.mock_exams for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own mock items"
on public.mock_items for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.mock_exams from anon, authenticated;
revoke all on table public.mock_items from anon, authenticated;
grant select on table public.mock_exams to authenticated;
grant select on table public.mock_items to authenticated;

-- The signed-in Student's open mock of the Course, or a new `assembling`
-- one, which the caller then starts the workflow for (`queued`). A mock
-- still assembling after an hour fails first, so a dead workflow does not
-- block the Course. No row for an unknown or another Student's Course. The
-- partial unique index lets one of two concurrent calls insert.
create function public.queue_mock_exam(p_course_id uuid)
returns table (mock_id uuid, queued boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_owner uuid;
  v_id uuid;
begin
  select c.owner into v_owner
  from public.courses c
  where c.id = p_course_id and c.owner = (select auth.uid());
  if v_owner is null then
    return;
  end if;

  update public.mock_exams m
  set status = 'failed', failure = 'Assembling took longer than an hour.'
  where m.course_id = p_course_id
    and m.status = 'assembling'
    and m.created_at < now() - interval '1 hour';

  insert into public.mock_exams (owner, course_id)
  values (v_owner, p_course_id)
  on conflict (course_id) where status in ('assembling', 'ready', 'in_progress')
  do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  return query
  select m.id, false
  from public.mock_exams m
  where m.course_id = p_course_id
    and m.status in ('assembling', 'ready', 'in_progress');
end;
$$;

comment on function public.queue_mock_exam(uuid) is 'The caller''s open mock of the Course, or a new assembling one (queued = true) whose workflow the caller starts.';

-- Fails the signed-in Student's assembling mock after the server's
-- `start()` of its workflow failed; true when it did.
create function public.release_mock_exam(p_mock_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with released as (
    update public.mock_exams
    set status = 'failed', failure = 'Assembling could not start.'
    where id = p_mock_id
      and owner = (select auth.uid())
      and status = 'assembling'
    returning id
  )
  select exists (select 1 from released);
$$;

comment on function public.release_mock_exam(uuid) is 'Fails the caller''s assembling mock whose workflow could not start; true when it did.';

revoke execute on function public.queue_mock_exam(uuid) from public, anon;
grant execute on function public.queue_mock_exam(uuid) to authenticated;
revoke execute on function public.release_mock_exam(uuid) from public, anon;
grant execute on function public.release_mock_exam(uuid) to authenticated;
