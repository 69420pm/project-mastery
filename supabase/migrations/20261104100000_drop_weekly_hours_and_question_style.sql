-- The Brief no longer asks for weekly hours or the question style (#241): the
-- study plan has no time estimate and nothing reads the style. Their stored
-- answers are lost. Dropping the columns drops their column grants.

alter table public.briefs
  drop column hours_per_week,
  drop column question_style;

-- save_brief without the two fields; the rest is as in
-- 20261101130000_old_exams_on_chapters.sql.
create or replace function public.save_brief(
  course_id uuid,
  fields jsonb default '{}',
  excluded_material_ids uuid[] default null,
  exam_chapter_ids uuid[] default null,
  asked_chapter_ids uuid[] default null,
  course_language text default null
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

  if exam_chapter_ids is not null then
    update public.chapters c
    set
      is_exam = case
        when c.id = any (exam_chapter_ids) then true
        when c.is_exam is true or c.id = any (coalesce(asked_chapter_ids, '{}')) then false
        else c.is_exam
      end,
      exam_asked = c.exam_asked
        or (
          c.id = any (coalesce(asked_chapter_ids, '{}'))
          and exists (
            select 1 from public.materials m
            where m.id = c.material_id and m.parse_status = 'parsed'
          )
        )
    where c.course_id = save_brief.course_id;

    update public.briefs b
    set reserved_exam_chapter_id = null, reserved_exam_answered = false
    where b.course_id = save_brief.course_id
      and b.reserved_exam_chapter_id is not null
      and not b.reserved_exam_chapter_id = any (exam_chapter_ids);
  end if;

  update public.briefs b
  set
    exam_date = case when fields ? 'exam_date' then (fields ->> 'exam_date')::date else b.exam_date end,
    goal = case when fields ? 'goal' then fields ->> 'goal' else b.goal end,
    open_book = case when fields ? 'open_book' then (fields ->> 'open_book')::boolean else b.open_book end,
    formula_sheet = case when fields ? 'formula_sheet' then (fields ->> 'formula_sheet')::boolean else b.formula_sheet end,
    calculator = case when fields ? 'calculator' then (fields ->> 'calculator')::boolean else b.calculator end,
    scope_confirmed = case when fields ? 'scope_confirmed' then (fields ->> 'scope_confirmed')::boolean else b.scope_confirmed end,
    reserved_exam_chapter_id = case when fields ? 'reserved_exam_chapter_id' then (fields ->> 'reserved_exam_chapter_id')::uuid else b.reserved_exam_chapter_id end,
    reserved_exam_answered = case when fields ? 'reserved_exam_answered' then (fields ->> 'reserved_exam_answered')::boolean else b.reserved_exam_answered end
  where b.course_id = save_brief.course_id;

  if excluded_material_ids is not null then
    delete from public.brief_excluded_materials e
    where e.course_id = save_brief.course_id;
    insert into public.brief_excluded_materials (course_id, material_id)
    select distinct save_brief.course_id, m.id
    from unnest(excluded_material_ids) as m (id);
  end if;

  if course_language is not null then
    update public.courses c
    set language = course_language
    where c.id = save_brief.course_id;
  end if;
  return true;
end;
$$;
