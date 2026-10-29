-- Removes the old Knowledge map build (#225, slice 1 of #222): its store
-- functions, and what the map no longer holds: Bloom levels, the
-- Prerequisites' confidence, Semantic links, prior KCs, why a Topic matters,
-- and the Exercises' name, task type and generated solutions. Until the
-- build from Parts lands, the build workflow only marks a build built.
-- Changes the schema only: no map rows exist (#222, Shipping).

drop function public.apply_knowledge_map_update(uuid, jsonb, uuid[], jsonb);
drop function public.replace_topics(uuid, jsonb);
drop function public.replace_reading_sections(uuid, jsonb, boolean);

drop table public.semantic_links;

alter table public.prerequisite_links drop column extraction_confidence;

alter table public.kcs drop constraint kcs_check;
alter table public.kcs drop constraint kcs_check1;
alter table public.kcs drop constraint kcs_check2;
alter table public.kcs drop column bloom;
alter table public.kcs drop constraint kcs_type_check;
alter table public.kcs
  add constraint kcs_type_check check (type in ('fact', 'concept', 'procedure', 'decision'));
alter table public.kcs drop constraint kcs_origin_check;
alter table public.kcs
  add constraint kcs_origin_check check (origin in ('content', 'exercise'));
alter table public.kcs alter column big_idea_id set not null;

comment on table public.kcs is 'A knowledge component of a Course''s Knowledge map: one thing a Student can learn.';

alter table public.topics drop column why_it_matters;

alter table public.exercises drop constraint exercises_check;
alter table public.exercises
  drop column name,
  drop column task_type,
  drop column solution,
  drop column solution_status;

comment on table public.exercises is 'An exercise subtask of a Course, with the KCs it tests and its difficulty.';

-- Generated Problems carried their Exercise's task type.
alter table public.problems drop column task_type;
