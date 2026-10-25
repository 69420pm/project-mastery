-- Tutoring M4d (#181): map Findings. When a Student's rebuild and the
-- Knowledge map disagree, the tutor checks the sources and files a Finding
-- on the map with `flagMap`: a missing or wrong link between two KCs, or a
-- wrong description of one, with a quote from a chunk that shows it. The
-- Student accepts or dismisses each on the Course map, and the next Update
-- map applies the accepted ones and marks them applied with an outcome.
--
-- They are separate from `findings`, which the build asks about the
-- Materials: the build's apply_knowledge_map_update, the Brief and
-- Priorities never read this table. Nothing in a map Finding changes KCs,
-- links, attempts or grades until the build applies it.

create table public.map_findings (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  -- The session whose Chat the tutor filed it in.
  study_session_id uuid not null references public.study_sessions (id) on delete cascade,
  kind text not null check (kind in ('missing_link', 'wrong_link', 'wrong_description')),
  -- A Finding goes with its KCs and its chunk: a merged or dropped KC, or a
  -- deleted chunk, takes it along.
  kc_id uuid not null references public.kcs (id) on delete cascade,
  -- For a link kind, the prerequisite (or semantic neighbour) of kc_id;
  -- null for wrong_description.
  linked_kc_id uuid references public.kcs (id) on delete cascade,
  -- The chunk the quote is from, which gives its page.
  chunk_id uuid not null references public.chunks (id) on delete cascade,
  quote text not null check (char_length(quote) between 1 and 500),
  -- One line.
  reason text not null check (char_length(reason) between 1 and 300 and reason !~ '[\r\n]'),
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'applied')),
  -- The build's one-line note on what it changed, set with applied.
  outcome text check (char_length(outcome) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'wrong_description') = (linked_kc_id is null)),
  check (linked_kc_id is distinct from kc_id),
  check ((status = 'applied') = (outcome is not null))
);

comment on table public.map_findings is 'A Finding on the Knowledge map that the tutor filed in a Study session, with a quote from a chunk; the Student accepts or dismisses it, and the next Update map applies the accepted ones.';

create index map_findings_course_id_status_idx on public.map_findings (course_id, status);
create index map_findings_owner_idx on public.map_findings (owner);
create index map_findings_study_session_id_idx on public.map_findings (study_session_id);
create index map_findings_kc_id_idx on public.map_findings (kc_id);
create index map_findings_linked_kc_id_idx on public.map_findings (linked_kc_id);
create index map_findings_chunk_id_idx on public.map_findings (chunk_id);

create trigger map_findings_set_updated_at
before update on public.map_findings
for each row execute function private.set_updated_at();

alter table public.map_findings enable row level security;

create policy "Students can read their own map findings"
on public.map_findings for select to authenticated
using ((select auth.uid()) = owner);

-- Only open, in the Student's own session of the Course, on KCs and a chunk
-- of that Course.
create policy "Students can file map findings in their own sessions"
on public.map_findings for insert to authenticated
with check (
  (select auth.uid()) = owner
  and status = 'open'
  and exists (
    select 1 from public.study_sessions
    where study_sessions.id = map_findings.study_session_id
      and study_sessions.owner = (select auth.uid())
      and study_sessions.course_id = map_findings.course_id
  )
  and exists (
    select 1 from public.kcs
    where kcs.id = map_findings.kc_id and kcs.course_id = map_findings.course_id
  )
  and (
    map_findings.linked_kc_id is null
    or exists (
      select 1 from public.kcs
      where kcs.id = map_findings.linked_kc_id and kcs.course_id = map_findings.course_id
    )
  )
  and exists (
    select 1 from public.chunks
    where chunks.id = map_findings.chunk_id and chunks.course_id = map_findings.course_id
  )
);

-- A Student answers an open Finding once: accepted or dismissed. Only the
-- build, as the service role, marks it applied with its outcome.
create policy "Students can accept or dismiss their own open map findings"
on public.map_findings for update to authenticated
using ((select auth.uid()) = owner and status = 'open')
with check ((select auth.uid()) = owner and status in ('accepted', 'dismissed'));

revoke all on table public.map_findings from anon, authenticated;
grant select on table public.map_findings to authenticated;
grant insert (course_id, study_session_id, kind, kc_id, linked_kc_id, chunk_id, quote, reason)
  on table public.map_findings to authenticated;
grant update (status) on table public.map_findings to authenticated;
