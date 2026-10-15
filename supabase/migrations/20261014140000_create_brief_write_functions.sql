-- The writes of the Brief's tools, each in one transaction (#84): a failed
-- save changes nothing, and concurrent tool calls of one reply do not
-- overwrite each other. Both run as the caller, so Row Level Security and the
-- column grants of public.briefs apply.

-- Changes the fixed fields named in `fields` (keys are column names; a null
-- value is stored as given) and, when `excluded_material_ids` is not null,
-- makes it the set of Materials the exam excludes. False when the caller has
-- no Brief for the Course. The row lock of the update serializes concurrent
-- saves of one Brief.
create function public.save_brief(
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
    scope_confirmed = case when fields ? 'scope_confirmed' then (fields ->> 'scope_confirmed')::boolean else b.scope_confirmed end
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

comment on function public.save_brief(uuid, jsonb, uuid[]) is 'Changes the given fields and, unless null, the excluded Materials of the caller''s Brief, all or nothing; false without a Brief.';

-- Appends `text` to the notes of the caller's Brief, after a blank line when
-- there are notes. Null when the caller has no Brief for the Course, false
-- when the notes would grow past their limit (nothing changes then). The
-- single update appends to the notes as they are when it runs, so concurrent
-- calls keep every statement.
create function public.add_brief_note(course_id uuid, text text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  appended boolean;
begin
  update public.briefs b
  set notes = case
    when coalesce(b.notes, '') = '' then add_brief_note.text
    else b.notes || E'\n\n' || add_brief_note.text
  end
  where b.course_id = add_brief_note.course_id
  returning true into appended;
  return appended;
exception
  when check_violation then
    return false;
end;
$$;

comment on function public.add_brief_note(uuid, text) is 'Appends a statement to the notes of the caller''s Brief; false when they would be too long, null without a Brief.';

revoke execute on function public.save_brief(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.save_brief(uuid, jsonb, uuid[]) to authenticated;
revoke execute on function public.add_brief_note(uuid, text) from public, anon;
grant execute on function public.add_brief_note(uuid, text) to authenticated;
