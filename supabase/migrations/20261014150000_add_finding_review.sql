-- Findings become a review queue (#85): each is `open` until the Student
-- answers it in the Brief, and a map update can find `scope` remarks in the
-- Materials, such as "not exam-relevant". The workflow still writes every
-- other column; a Student may update only the review columns of their own
-- Findings. apply_knowledge_map_update keeps stored Findings as they are, so
-- answers survive updates.

alter table public.findings drop constraint findings_kind_check;
alter table public.findings
  add constraint findings_kind_check check (kind in ('solution_mismatch', 'scope'));

alter table public.findings
  add column status text not null default 'open' check (status in ('open', 'answered')),
  -- The Student's answer, verbatim.
  add column answer text check (char_length(answer) between 1 and 2000),
  -- When the Brief asked it; null before.
  add column asked_at timestamptz,
  add column answered_at timestamptz,
  add constraint findings_status_answer_check
    check ((status = 'answered') = (answer is not null)),
  add constraint findings_status_answered_at_check
    check ((status = 'answered') = (answered_at is not null));

comment on table public.findings is 'Something a Knowledge map update found in a Course''s material that the Student should confirm, such as a printed solution that does not match or a remark that limits exam content, with the Student''s answer.';

create policy "Students can answer their own findings"
on public.findings for update to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

grant update (status, answer, asked_at, answered_at) on table public.findings to authenticated;
