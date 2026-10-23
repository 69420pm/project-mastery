-- Tutoring M1 (#173): every Chat is a Study session, the AI asks its graded
-- questions as Questions, and grades each answer into attempts labelled
-- full, partial or wrong (ADR 0018).
--
-- The Chats, their messages and the attempts so far are test data: they are
-- deleted, and the attempts table is recreated in its new shape. Their usage
-- records stay (ai_usage.chat_id is on delete set null). Courses, maps,
-- Briefs and Memories stay.

delete from public.chats;
drop table public.attempts;

-- The Chat has one model: the picker and its stored choice are gone.
alter table public.chats drop column model_choice;

-- The numeric final results of an Exercise's solution, which `grade` checks
-- a Student's final value against: a list of { label, value, unit }. Null
-- when there is none, and for Exercises analysed before this column.
alter table public.exercises add column final_answers jsonb check (
  final_answers is null or jsonb_typeof(final_answers) = 'array'
);

-- Study sessions ------------------------------------------------------------

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  -- The Chat it runs in. A deleted Chat leaves its session, with its
  -- questions and attempts: they are the Student's learning evidence.
  chat_id uuid unique references public.chats (id) on delete set null,
  course_id uuid not null references public.courses (id) on delete cascade,
  mode text not null check (mode in ('learn', 'review', 'practice', 'mock', 'results')),
  -- The Topic it studies; null until Topics exist (M3).
  topic_id uuid,
  -- Where a learn session stands; null until stages exist (M4).
  stage text check (char_length(stage) <= 50),
  started_at timestamptz not null default now(),
  -- Null while it runs; nothing ends a session yet (M2).
  ended_at timestamptz
);

comment on table public.study_sessions is 'A Study session: one per Chat, created with it. Holds the questions asked and the attempts graded in it.';

create index study_sessions_course_id_idx on public.study_sessions (course_id);
create index study_sessions_owner_idx on public.study_sessions (owner);

alter table public.study_sessions enable row level security;

create policy "Students can read their own study sessions"
on public.study_sessions for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.study_sessions from anon, authenticated;
grant select on table public.study_sessions to authenticated;

-- Every new Chat starts a learn session in its Course. Runs as its owner,
-- since Students cannot create sessions themselves; the insert policy on
-- chats has already checked the Course is theirs.
create function private.start_study_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.study_sessions (owner, chat_id, course_id, mode)
  values (new.owner, new.id, new.course_id, 'learn');
  return new;
end;
$$;

revoke execute on function private.start_study_session() from public, anon, authenticated;

create trigger chats_start_study_session
after insert on public.chats
for each row execute function private.start_study_session();

-- Questions -----------------------------------------------------------------

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  kind text not null check (
    kind in ('prequestion', 'recall', 'question', 'problem', 'rebuild', 'mock_item')
  ),
  -- Markdown with LaTeX.
  prompt text not null check (char_length(prompt) between 1 and 20000),
  -- The Exercise it poses; null for the AI's own questions.
  exercise_id uuid references public.exercises (id) on delete set null,
  asked_at timestamptz not null default now(),
  answer_text text check (char_length(answer_text) <= 20000),
  -- The Student message that sent the answer.
  answer_message_id uuid references public.chat_messages (id) on delete set null,
  answered_at timestamptz,
  graded_at timestamptz
);

comment on table public.questions is 'A graded question the AI asked in a Study session, with the Student''s answer once given.';

create index questions_session_id_idx on public.questions (session_id);
create index questions_owner_idx on public.questions (owner);
create index questions_exercise_id_idx on public.questions (exercise_id);
create index questions_answer_message_id_idx on public.questions (answer_message_id);

create table public.question_kcs (
  question_id uuid not null references public.questions (id) on delete cascade,
  kc_id uuid not null references public.kcs (id) on delete cascade,
  primary key (question_id, kc_id)
);

comment on table public.question_kcs is 'The KCs a question tests.';

create index question_kcs_kc_id_idx on public.question_kcs (kc_id);

alter table public.questions enable row level security;

create policy "Students can read their own questions"
on public.questions for select to authenticated
using ((select auth.uid()) = owner);

-- Only in the Student's own session, and on an Exercise of its Course.
create policy "Students can ask questions in their own sessions"
on public.questions for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.study_sessions
    where study_sessions.id = questions.session_id
      and study_sessions.owner = (select auth.uid())
      and (
        questions.exercise_id is null
        or exists (
          select 1 from public.exercises
          where exercises.id = questions.exercise_id
            and exercises.course_id = study_sessions.course_id
        )
      )
  )
);

create policy "Students can answer and grade their own questions"
on public.questions for update to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

alter table public.question_kcs enable row level security;

create policy "Students can read their own question KCs"
on public.question_kcs for select to authenticated
using (
  exists (
    select 1 from public.questions
    where questions.id = question_kcs.question_id
      and questions.owner = (select auth.uid())
  )
);

-- Only KCs of the Course the question's session is in.
create policy "Students can tag their own questions with KCs of the Course"
on public.question_kcs for insert to authenticated
with check (
  exists (
    select 1
    from public.questions
    join public.study_sessions on study_sessions.id = questions.session_id
    join public.kcs on kcs.course_id = study_sessions.course_id
    where questions.id = question_kcs.question_id
      and questions.owner = (select auth.uid())
      and kcs.id = question_kcs.kc_id
  )
);

-- What is asked and when never changes; only the answer and grading are
-- filled in.
revoke all on table public.questions from anon, authenticated;
grant select on table public.questions to authenticated;
grant insert (session_id, kind, prompt, exercise_id) on table public.questions to authenticated;
grant update (answer_text, answer_message_id, answered_at, graded_at)
  on table public.questions to authenticated;

revoke all on table public.question_kcs from anon, authenticated;
grant select, insert on table public.question_kcs to authenticated;

-- Attempts ------------------------------------------------------------------

-- The evidence on one KC of a graded question. It is the only stored
-- learner state: code replays a KC's attempts into its level and next
-- review (src/features/study/domain/ladder.ts). The log is immutable: a
-- Student reads and adds their own rows, never changes them, and they go
-- with their session, question or KC.
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  kc_id uuid not null references public.kcs (id) on delete cascade,
  -- pre for prequestions; learn otherwise in M1.
  kind text not null check (kind in ('pre', 'learn')),
  result text not null check (result in ('full', 'partial', 'wrong')),
  -- How much the AI helped: none, some, or it showed the solution.
  help text not null check (help in ('none', 'some', 'solution_shown')),
  -- How the final value compared with the Exercise's key; null when not checked.
  "check" text check ("check" in ('match', 'mismatch')),
  created_at timestamptz not null default now()
);

comment on table public.attempts is 'The graded evidence for one KC from one question. Immutable; replayed into the KC''s review ladder.';

create index attempts_kc_id_created_at_idx on public.attempts (kc_id, created_at);
create index attempts_session_id_idx on public.attempts (session_id);
create index attempts_question_id_idx on public.attempts (question_id);
create index attempts_owner_idx on public.attempts (owner);

alter table public.attempts enable row level security;

create policy "Students can read their own attempts"
on public.attempts for select to authenticated
using ((select auth.uid()) = owner);

-- Only on a KC the Student's own question tests, in that question's session.
create policy "Students can record attempts on their own questions"
on public.attempts for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1
    from public.questions
    join public.question_kcs on question_kcs.question_id = questions.id
    where questions.id = attempts.question_id
      and questions.owner = (select auth.uid())
      and questions.session_id = attempts.session_id
      and question_kcs.kc_id = attempts.kc_id
  )
);

-- The owner and the time are the database's, so attempts cannot be
-- backdated, and rows are never changed.
revoke all on table public.attempts from anon, authenticated;
grant select on table public.attempts to authenticated;
grant insert (question_id, session_id, kc_id, kind, result, help, "check")
  on table public.attempts to authenticated;
