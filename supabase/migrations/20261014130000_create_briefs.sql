-- A Course's Brief: what the Student told the AI about the exam, and the
-- conversation in which they told it (#84).

create table public.briefs (
  course_id uuid primary key references public.courses (id) on delete cascade,
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- Every field is null until the Student has answered it.
  exam_date date,
  goal text check (goal in ('pass', 'good_grade', 'master_everything')),
  hours_per_week numeric check (hours_per_week > 0 and hours_per_week <= 80),
  question_style text check (question_style in ('written', 'multiple_choice', 'mixed')),
  open_book boolean,
  formula_sheet boolean,
  calculator boolean,
  -- Whether the Student confirmed which Materials the exam covers.
  scope_confirmed boolean not null default false,
  -- The Student's free-text statements, separated by blank lines.
  notes text check (char_length(notes) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.briefs is 'What a Student told the AI about a Course''s exam. One row per Course, created when its Brief page is first opened.';

create index briefs_owner_idx on public.briefs (owner);

create trigger briefs_set_updated_at
before update on public.briefs
for each row execute function private.set_updated_at();

-- Materials the exam does not cover.
create table public.brief_excluded_materials (
  course_id uuid not null references public.briefs (course_id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  primary key (course_id, material_id)
);

create index brief_excluded_materials_owner_idx on public.brief_excluded_materials (owner);
create index brief_excluded_materials_material_id_idx on public.brief_excluded_materials (material_id);

create table public.brief_messages (
  -- Ids come from the AI SDK: the client's for Student messages, the
  -- server's for AI messages.
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.briefs (course_id) on delete cascade,
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- The message parts as stored by the AI SDK (UIMessage.parts).
  parts jsonb not null check (jsonb_typeof(parts) = 'array'),
  -- The model that wrote an AI message.
  model_id text check (char_length(model_id) <= 200),
  -- clock_timestamp, not now: messages saved in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp(),
  check ((role = 'assistant') = (model_id is not null))
);

comment on table public.brief_messages is 'The conversation of a Brief, in the AI SDK UIMessage format, ordered by created_at.';

create index brief_messages_course_id_created_at_idx on public.brief_messages (course_id, created_at);
create index brief_messages_owner_idx on public.brief_messages (owner);

-- Row Level Security: a Student reads and changes only their own Briefs.
alter table public.briefs enable row level security;

create policy "Students can read their own briefs"
on public.briefs for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can create briefs for their own courses"
on public.briefs for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.courses
    where courses.id = briefs.course_id and courses.owner = (select auth.uid())
  )
);

create policy "Students can update their own briefs"
on public.briefs for update to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

alter table public.brief_excluded_materials enable row level security;

create policy "Students can read their own excluded materials"
on public.brief_excluded_materials for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can exclude their own materials from their briefs"
on public.brief_excluded_materials for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.briefs
    where briefs.course_id = brief_excluded_materials.course_id
      and briefs.owner = (select auth.uid())
  )
  and exists (
    select 1 from public.materials
    where materials.id = brief_excluded_materials.material_id
      and materials.owner = (select auth.uid())
      and materials.course_id = brief_excluded_materials.course_id
  )
);

create policy "Students can include their materials in their briefs again"
on public.brief_excluded_materials for delete to authenticated
using ((select auth.uid()) = owner);

alter table public.brief_messages enable row level security;

create policy "Students can read their own brief messages"
on public.brief_messages for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can add messages to their own briefs"
on public.brief_messages for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.briefs
    where briefs.course_id = brief_messages.course_id
      and briefs.owner = (select auth.uid())
  )
);

-- Grant only what the policies allow. Stored messages are never edited.
revoke all on table public.briefs from anon, authenticated;
grant select, insert on table public.briefs to authenticated;
grant update (exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes)
  on table public.briefs to authenticated;

revoke all on table public.brief_excluded_materials from anon, authenticated;
grant select, insert, delete on table public.brief_excluded_materials to authenticated;

revoke all on table public.brief_messages from anon, authenticated;
grant select, insert on table public.brief_messages to authenticated;
