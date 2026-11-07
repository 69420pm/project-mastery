-- What the map is built from changed since its last build (#249): a Material
-- finished parsing or was deleted, or the Student confirmed or withdrew an
-- old exam. The Course map then asks for Update map; a build clears the mark
-- when it starts reading the Course.

alter table public.knowledge_map_builds
  add column needs_update boolean not null default false;

comment on column public.knowledge_map_builds.needs_update is
  'Set when a Material finished parsing or was deleted, or an old exam was confirmed or withdrawn, since the build began; cleared by the build workflow when it starts. The Course map asks for Update map while it is set.';

-- A Student changes their own Materials and Chapters but can't write the
-- build row, so the mark is set as its owner.
create function public.mark_map_needs_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.knowledge_map_builds
  set needs_update = true
  where course_id = (case when tg_op = 'DELETE' then old.course_id else new.course_id end);
  return null;
end;
$$;

revoke all on function public.mark_map_needs_update() from public, anon, authenticated;

create trigger chapters_exam_marks_map
after update of is_exam on public.chapters
for each row
when (old.is_exam is distinct from new.is_exam)
execute function public.mark_map_needs_update();

create trigger materials_parsed_marks_map
after update of parse_status on public.materials
for each row
when (new.parse_status = 'parsed' and old.parse_status is distinct from 'parsed')
execute function public.mark_map_needs_update();

create trigger materials_deleted_marks_map
after delete on public.materials
for each row
execute function public.mark_map_needs_update();
