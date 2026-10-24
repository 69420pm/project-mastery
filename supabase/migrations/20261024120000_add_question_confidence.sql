-- Tutoring M2 (#174): a task card asks how sure the Student is, from 1 to 4,
-- and the replay rates a quick, fully confident answer Easy. The Student's
-- answer stores it with `answer_text`.
alter table public.questions
  add column confidence smallint check (confidence between 1 and 4);

comment on column public.questions.confidence is 'How sure the Student said they were when answering, from 1 (unsure) to 4 (sure). Null when not given.';

grant update (confidence) on table public.questions to authenticated;
