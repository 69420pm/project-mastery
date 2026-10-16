-- The AI's write to the Memory (#107): the `remember` tool appends one dated
-- line. One statement on the text as it is when it runs, so concurrent calls
-- keep each other's lines. Security invoker: the policies and column grants
-- of `memories` apply as for the Student.

create function public.append_memory(course_id uuid, text text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  appended boolean;
begin
  -- The constraint, not `(course_id)`, which would clash with the parameter.
  insert into public.memories as m (course_id, text)
  values (
    append_memory.course_id,
    to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ': ' || append_memory.text
  )
  on conflict on constraint memories_pkey do update
  set text = case
    when m.text = '' then excluded.text
    else m.text || E'\n' || excluded.text
  end
  returning true into appended;
  return appended;
exception
  when check_violation then
    return false;
end;
$$;

comment on function public.append_memory(uuid, text) is 'Appends a line "YYYY-MM-DD: text" (UTC) to the caller''s Memory of a Course, creating it; false, changing nothing, when it would pass 4,000 characters.';

revoke execute on function public.append_memory(uuid, text) from public, anon;
grant execute on function public.append_memory(uuid, text) to authenticated;
