-- Old exams on Chapters (#229, slice 18 of #222). The Brief confirms old
-- exams as Chapters, so an exam inside a script counts; the Reserved exam
-- and the final Mock exam name a Chapter; the Course gets a language the
-- Student can choose. No data to convert.

-- Old exams -----------------------------------------------------------------

alter table public.chapters
  add column is_exam boolean,
  add column exam_asked boolean not null default false;

comment on column public.chapters.is_exam is 'Whether the Student confirmed the Chapter as an old exam, covering its subtree; null until they answered.';
comment on column public.chapters.exam_asked is 'Whether the Brief has asked if the Chapter is an old exam.';

-- `save_brief` writes them as the caller.
create policy "Students can update their own chapters"
on public.chapters
for update
to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

grant update (is_exam, exam_asked) on table public.chapters to authenticated;

-- The reserved exam and the final mock name a Chapter. The trigger is
-- dropped with the column it watches.
drop trigger briefs_check_reserved_exam on public.briefs;

alter table public.briefs drop column reserved_exam_material_id;

-- The reserved old-exam Chapter, hiding its subtree; null when none is
-- reserved, or when the Chapter was deleted by a new parse.
alter table public.briefs
  add column reserved_exam_chapter_id uuid references public.chapters (id) on delete set null;

create index briefs_reserved_exam_chapter_id_idx on public.briefs (reserved_exam_chapter_id);

grant update (reserved_exam_chapter_id) on table public.briefs to authenticated;

-- A reserved Chapter must be an old exam of the Brief's own Course. Runs as
-- the caller, so Row Level Security hides another Student's Chapters.
create or replace function private.check_reserved_exam()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.reserved_exam_chapter_id is not null and not exists (
    select 1 from public.chapters c
    where c.id = new.reserved_exam_chapter_id
      and c.course_id = new.course_id
      and c.is_exam is true
  ) then
    raise exception 'The reserved exam must be an old exam of the Course'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger briefs_check_reserved_exam
before insert or update of reserved_exam_chapter_id on public.briefs
for each row execute function private.check_reserved_exam();

alter table public.mock_exams drop column reserved_material_id;

-- The reserved exam Chapter a final mock is; null for every other mock.
alter table public.mock_exams
  add column reserved_chapter_id uuid references public.chapters (id) on delete set null;

create index mock_exams_reserved_chapter_id_idx on public.mock_exams (reserved_chapter_id);

alter table public.materials
  drop column is_exam,
  drop column exam_asked;

-- As before, and a new parse keeps the Brief's answers: each new Chapter
-- with the depth and title of an earlier one (the n-th of that depth and
-- title to the n-th) takes its old-exam answer, and a Reserved exam or a
-- final mock on the earlier Chapter moves to it.
create or replace function public.replace_material_chunks(
  p_material_id uuid,
  p_chapters jsonb,
  p_chunks jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_course_id uuid;
  v_old jsonb;
begin
  select owner, course_id into v_owner, v_course_id
  from public.materials
  where id = p_material_id
  for update;
  if not found then
    return;
  end if;

  -- The earlier Chapters with what points at them, which the delete clears.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'depth', c.depth, 'title', c.title, 'position', c.position,
    'is_exam', c.is_exam, 'exam_asked', c.exam_asked,
    'briefs', (select coalesce(jsonb_agg(b.course_id), '[]') from public.briefs b where b.reserved_exam_chapter_id = c.id),
    'mocks', (select coalesce(jsonb_agg(m.id), '[]') from public.mock_exams m where m.reserved_chapter_id = c.id)
  )), '[]')
  into v_old
  from public.chapters c
  where c.material_id = p_material_id;

  delete from public.chunks where material_id = p_material_id;
  delete from public.chapters where material_id = p_material_id;

  -- Ids first, so a Chapter's parent is found by its position. A parent
  -- position without a Chapter leaves the parent null, which only the root
  -- may have.
  with c as (
    select gen_random_uuid() as id, r.*
    from jsonb_to_recordset(p_chapters) as r (
      position integer, parent_position integer, depth integer, title text,
      page_from integer, exam_proposed boolean
    )
  )
  insert into public.chapters (
    id, owner, course_id, material_id, parent_id, position, depth, title,
    page_from, exam_proposed
  )
  select
    c.id, v_owner, v_course_id, p_material_id, parent.id, c.position, c.depth,
    c.title, c.page_from, coalesce(c.exam_proposed, false)
  from c
  left join c as parent on parent.position = c.parent_position;

  insert into public.chunks (
    owner, course_id, material_id, chapter_id, position, page_from, page_to,
    label, markdown
  )
  select
    v_owner, v_course_id, p_material_id, chapter.id, c.position, c.page_from,
    c.page_to, c.label, c.markdown
  from jsonb_to_recordset(p_chunks) as c (
    position integer, page_from integer, page_to integer, label text,
    markdown text, chapter_position integer
  )
  left join public.chapters as chapter
    on chapter.material_id = p_material_id
    and chapter.position = c.chapter_position;

  with old as (
    select o.*, row_number() over (partition by o.depth, o.title order by o.position) as n
    from jsonb_to_recordset(v_old) as o (
      id uuid, depth integer, title text, position integer, is_exam boolean,
      exam_asked boolean, briefs jsonb, mocks jsonb
    )
  ),
  new as (
    select c.id, c.depth, c.title,
      row_number() over (partition by c.depth, c.title order by c.position) as n
    from public.chapters c
    where c.material_id = p_material_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', new.id, 'is_exam', old.is_exam, 'exam_asked', old.exam_asked,
    'briefs', old.briefs, 'mocks', old.mocks
  )), '[]')
  into v_old
  from old
  join new using (depth, title, n);

  update public.chapters c
  set is_exam = carried.is_exam, exam_asked = carried.exam_asked
  from jsonb_to_recordset(v_old) as carried (id uuid, is_exam boolean, exam_asked boolean)
  where c.id = carried.id;

  update public.briefs b
  set reserved_exam_chapter_id = carried.id
  from jsonb_to_recordset(v_old) as carried (id uuid, briefs jsonb)
  where carried.briefs ? b.course_id::text;

  update public.mock_exams m
  set reserved_chapter_id = carried.id
  from jsonb_to_recordset(v_old) as carried (id uuid, mocks jsonb)
  where carried.mocks ? m.id::text;
end;
$$;

-- Course language -------------------------------------------------------------

alter table public.courses
  add column language text check (char_length(language) between 2 and 35);

comment on column public.courses.language is 'The language the Student asked for in the Brief, as an English name such as German; null means the most common language of the Materials.';

grant update (language) on table public.courses to authenticated;

-- save_brief ----------------------------------------------------------------

drop function public.save_brief(uuid, jsonb, uuid[], uuid[], uuid[]);

-- Changes the given fields of the caller's Brief, all or nothing:
-- - `excluded_material_ids`, unless null, replaces the excluded Materials.
-- - `exam_chapter_ids`, unless null, are the Course's old-exam Chapters:
--   they become old exams, and every other Chapter that was one, or that is
--   among `asked_chapter_ids`, becomes none; the rest stay unanswered. The
--   Chapters among `asked_chapter_ids` of parsed Materials count as asked.
--   A Reserved exam that is no longer an old exam loses its reservation, so
--   the Brief asks again.
-- - `course_language`, unless null, becomes the Course's language.
create function public.save_brief(
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
    hours_per_week = case when fields ? 'hours_per_week' then (fields ->> 'hours_per_week')::numeric else b.hours_per_week end,
    question_style = case when fields ? 'question_style' then fields ->> 'question_style' else b.question_style end,
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

comment on function public.save_brief(uuid, jsonb, uuid[], uuid[], uuid[], text) is 'Changes the given fields and, unless null, the excluded Materials, the old-exam Chapters and the Course language of the caller''s Brief, marking the listed Chapters asked, all or nothing; false without a Brief.';

revoke execute on function public.save_brief(uuid, jsonb, uuid[], uuid[], uuid[], text) from public, anon;
grant execute on function public.save_brief(uuid, jsonb, uuid[], uuid[], uuid[], text) to authenticated;
