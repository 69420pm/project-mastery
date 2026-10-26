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
