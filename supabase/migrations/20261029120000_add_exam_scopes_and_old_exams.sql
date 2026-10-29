-- The Brief confirms old exams and the exam scope (#224, slice 3 of #222).
-- Adds exam scopes and the old-exam question's state, lets `save_brief` set
-- the old exams, and removes the Findings of the old build.

-- Findings ------------------------------------------------------------------

drop table public.finding_sources;
drop table public.findings;

-- Old exams -----------------------------------------------------------------

-- Whether the Brief has asked if the Material is an old exam. A Material
-- parsed after intake is asked once, in a static message.
alter table public.materials
  add column exam_asked boolean not null default false;

-- `save_brief` writes them as the caller.
grant update (is_exam, exam_asked) on table public.materials to authenticated;

drop function public.save_brief(uuid, jsonb, uuid[]);

-- As before, and when `exam_material_ids` is not null, makes those Materials
-- the Course's old exams: every Material of the Course is or is not one, and
-- every parsed Material counts as asked. A Reserved exam that is no longer
-- an old exam loses its reservation, so the Brief asks again.
create function public.save_brief(
  course_id uuid,
  fields jsonb default '{}',
  excluded_material_ids uuid[] default null,
  exam_material_ids uuid[] default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.briefs b
  where b.course_id = save_brief.course_id
  for update;
  if not found then
    return false;
  end if;

  if exam_material_ids is not null then
    update public.materials m
    set
      is_exam = m.id = any (exam_material_ids),
      exam_asked = m.exam_asked or m.parse_status = 'parsed'
    where m.course_id = save_brief.course_id;

    update public.briefs b
    set reserved_exam_material_id = null, reserved_exam_answered = false
    where b.course_id = save_brief.course_id
      and b.reserved_exam_material_id is not null
      and not b.reserved_exam_material_id = any (exam_material_ids);
  end if;

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

comment on function public.save_brief(uuid, jsonb, uuid[], uuid[]) is 'Changes the given fields and, unless null, the excluded Materials and the old exams of the caller''s Brief, all or nothing; false without a Brief.';

revoke execute on function public.save_brief(uuid, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.save_brief(uuid, jsonb, uuid[], uuid[]) to authenticated;

-- Exam scopes ---------------------------------------------------------------

-- A Student-confirmed statement that the exam leaves out or stresses one Big
-- idea or Topic, in the Student's words. One per Big idea or Topic.
create table public.exam_scopes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  big_idea_id uuid references public.big_ideas (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete cascade,
  scope text not null check (scope in ('excluded', 'emphasized')),
  words text not null check (char_length(words) between 1 and 500),
  created_at timestamptz not null default now(),
  check (num_nonnulls(big_idea_id, topic_id) = 1)
);

comment on table public.exam_scopes is 'A Student-confirmed statement that the exam excludes or emphasizes one Big idea or Topic.';

create unique index exam_scopes_big_idea_id_key on public.exam_scopes (big_idea_id);
create unique index exam_scopes_topic_id_key on public.exam_scopes (topic_id);
create index exam_scopes_owner_idx on public.exam_scopes (owner);
create index exam_scopes_course_id_idx on public.exam_scopes (course_id);

alter table public.exam_scopes enable row level security;

create policy "Students can read their own exam scopes"
on public.exam_scopes for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can remove their own exam scopes"
on public.exam_scopes for delete to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.exam_scopes from anon, authenticated;
grant select, delete on table public.exam_scopes to authenticated;

-- Sets the exam scope of one Big idea or Topic of the caller's Course, or
-- removes it when `scope` is null, and bumps the Brief's `updated_at`. False,
-- changing nothing, when the caller has no Brief for the Course or the Big
-- idea or Topic is not the Course's; throws unless exactly one is given.
create function public.set_exam_scope(
  course_id uuid,
  big_idea_id uuid default null,
  topic_id uuid default null,
  scope text default null,
  words text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if num_nonnulls(set_exam_scope.big_idea_id, set_exam_scope.topic_id) <> 1 then
    raise exception 'Give a Big idea or a Topic' using errcode = '22023';
  end if;

  update public.briefs b
  set updated_at = now()
  where b.course_id = set_exam_scope.course_id
    and b.owner = (select auth.uid());
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.big_ideas i
    where i.id = set_exam_scope.big_idea_id and i.course_id = set_exam_scope.course_id
  ) and not exists (
    select 1 from public.topics t
    where t.id = set_exam_scope.topic_id and t.course_id = set_exam_scope.course_id
  ) then
    return false;
  end if;

  delete from public.exam_scopes s
  where s.course_id = set_exam_scope.course_id
    and (s.big_idea_id = set_exam_scope.big_idea_id or s.topic_id = set_exam_scope.topic_id);

  if scope is not null then
    insert into public.exam_scopes (owner, course_id, big_idea_id, topic_id, scope, words)
    values (
      (select auth.uid()),
      set_exam_scope.course_id,
      set_exam_scope.big_idea_id,
      set_exam_scope.topic_id,
      set_exam_scope.scope,
      set_exam_scope.words
    );
  end if;
  return true;
end;
$$;

comment on function public.set_exam_scope(uuid, uuid, uuid, text, text) is 'Sets or (scope null) removes the exam scope of a Big idea or Topic of the caller''s Course; false when it is not theirs.';

revoke execute on function public.set_exam_scope(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.set_exam_scope(uuid, uuid, uuid, text, text) to authenticated;
