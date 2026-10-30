-- Map Findings are applied when the Student accepts them (#224, slice 5 of
-- #222): `accept_map_finding` changes the map in one transaction and sets
-- `applied` with an outcome written here, so the status `accepted` and the
-- Update map's corrections step are gone. A wrong_description Finding carries
-- the description it proposes.

-- Findings never applied have no place to go: accepted ones waited for the
-- removed corrections step, and descriptions have no proposal.
delete from public.map_findings
where status = 'accepted' or kind = 'wrong_description';

alter table public.map_findings
  add column proposed_description text
    check (char_length(proposed_description) between 1 and 1000
      and btrim(proposed_description, E' \t\r\n') <> '');

alter table public.map_findings
  add constraint map_findings_proposal_kind_check
    check ((kind = 'wrong_description') = (proposed_description is not null));

alter table public.map_findings drop constraint map_findings_status_check;
alter table public.map_findings
  add constraint map_findings_status_check check (status in ('open', 'dismissed', 'applied'));

comment on column public.map_findings.linked_kc_id is 'For a link kind, the prerequisite of kc_id: the KC that kc_id builds on; null for wrong_description.';
comment on table public.map_findings is 'A Finding on the Knowledge map that the tutor filed in a Study session, with a quote from a chunk; accepting it applies the change, dismissing it closes it.';

grant insert (proposed_description) on table public.map_findings to authenticated;

-- A Student dismisses an open Finding; accepting goes through
-- accept_map_finding.
drop policy "Students can accept or dismiss their own open map findings" on public.map_findings;
create policy "Students can dismiss their own open map findings"
on public.map_findings for update to authenticated
using ((select auth.uid()) = owner and status = 'open')
with check ((select auth.uid()) = owner and status = 'dismissed');

-- Applies the signed-in Student's open map Finding and marks it applied.
-- Returns null when it did, or the reason it was refused, which leaves the
-- Finding open: a link that would close a cycle. A Finding that is not open
-- or not the Student's is refused as not found.
create function public.accept_map_finding(p_finding_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.map_findings%rowtype;
  v_outcome text;
begin
  select * into f
  from public.map_findings
  where id = p_finding_id and owner = (select auth.uid()) and status = 'open'
  for update;
  if not found then
    return 'This Finding was not found.';
  end if;

  if f.kind = 'missing_link' then
    -- linked_kc_id is the prerequisite: the link runs from it to kc_id, so
    -- it closes a cycle when kc_id already leads to linked_kc_id.
    if exists (
      with recursive reach (kc) as (
        select to_kc from public.prerequisite_links where from_kc = f.kc_id
        union
        select l.to_kc from public.prerequisite_links as l join reach on l.from_kc = reach.kc
      )
      select 1 from reach where kc = f.linked_kc_id
    ) then
      return 'This link would make a cycle.';
    end if;
    insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
    values (f.owner, f.course_id, f.linked_kc_id, f.kc_id)
    on conflict (from_kc, to_kc) do nothing;
    v_outcome := 'Added the prerequisite.';
  elsif f.kind = 'wrong_link' then
    delete from public.prerequisite_links
    where (from_kc = f.linked_kc_id and to_kc = f.kc_id)
       or (from_kc = f.kc_id and to_kc = f.linked_kc_id);
    v_outcome := 'Removed the link.';
  else
    update public.kcs set description = f.proposed_description where id = f.kc_id;
    v_outcome := 'Changed the description.';
  end if;

  update public.map_findings
  set status = 'applied', outcome = v_outcome
  where id = f.id;
  return null;
end;
$$;

revoke all on function public.accept_map_finding(uuid) from public, anon;
grant execute on function public.accept_map_finding(uuid) to authenticated;
