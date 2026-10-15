-- The model's adjustment of KC priorities (#86): one call per priority run
-- reads the Brief's notes and the answered Findings, and only when they or
-- the map changed after the last adjustment. Otherwise the run reuses the
-- stored adjustment.

-- When add_brief_note last changed the notes; null before the first note.
alter table public.briefs add column notes_updated_at timestamptz;

grant update (notes_updated_at) on table public.briefs to authenticated;

-- The model's last adjustment, as it answered: entries of a big idea or KC
-- id, a multiplier and a one-line reason. Empty before the first one, or
-- when there was nothing to adjust from.
alter table public.priority_runs
  add column adjustments jsonb not null default '[]'
  check (jsonb_typeof(adjustments) = 'array');

create or replace function public.add_brief_note(course_id uuid, text text)
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
  end,
  notes_updated_at = now()
  where b.course_id = add_brief_note.course_id
  returning true into appended;
  return appended;
exception
  when check_violation then
    return false;
end;
$$;

-- As before, and when p_adjustments is not null it becomes the run's stored
-- adjustment, with `adjusted_at` set to the run's `computed_at`: the time its
-- input was read, so a change during the run makes the next run call the
-- model again.
drop function public.replace_kc_priorities(uuid, jsonb);

create function public.replace_kc_priorities(
  p_course_id uuid,
  p_priorities jsonb,
  p_adjustments jsonb default null
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
  set status = 'done',
    failure_reason = null,
    adjustments = coalesce(p_adjustments, adjustments),
    adjusted_at = case when p_adjustments is null then adjusted_at else computed_at end
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_kc_priorities(uuid, jsonb, jsonb) is
  'Replaces a Course''s KC priorities, optionally stores the model''s adjustment, and marks the running priority run done, in one transaction. Priority workflow (service role) only.';

revoke execute on function public.replace_kc_priorities(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_kc_priorities(uuid, jsonb, jsonb)
  to service_role;
