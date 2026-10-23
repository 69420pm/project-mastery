-- Exercises and Findings of a Knowledge map (#70): apply_knowledge_map_update
-- stores them with the map, only the workflow writes them, and
-- owners read their own rows. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Chapter 7', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    0, 1, 1, 'exercise', 'Compute the efficiency.'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    1, 1, 1, 'solution', '46.5%'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    2, 1, 1, 'exercise', 'A deleted exercise.');

insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

-- The second exercise's chunk is gone, so it is skipped.
delete from public.chunks where id = 'cccccccc-0000-0000-0000-000000000003';

set local role service_role;
select is(
  public.apply_knowledge_map_update('aaaaaaaa-0000-0000-0000-000000000001',
    '{"bigIdeas": [{"id": "b1", "name": "Cycle", "description": "Brayton."}],
      "kcs": [
        {"id": "k1", "name": "Thermal efficiency", "description": "η.", "type": "procedure",
          "bloom": "apply", "bigIdea": "b1", "origin": "content", "sources": []},
        {"id": "k2", "name": "Propulsive power", "description": "F V0.", "type": "procedure",
          "bloom": "apply", "bigIdea": "b1", "origin": "exercise",
          "sources": ["cccccccc-0000-0000-0000-000000000001"]}],
      "prerequisites": [], "semanticLinks": [],
      "exercises": [
        {"id": "e1", "name": "Ex. 7.3", "questionChunk": "cccccccc-0000-0000-0000-000000000003",
          "taskType": "compute", "solutionStatus": "generated", "solution": "x", "difficulty": 1, "kcs": ["k1"]},
        {"id": "e2", "name": "Ex. 7.1", "questionChunk": "cccccccc-0000-0000-0000-000000000001",
          "taskType": "compute thermal efficiency", "solutionStatus": "disputed", "solution": null,
          "difficulty": 3, "kcs": ["k1", "k2"],
          "finalAnswers": [{"label": "Thermal efficiency", "value": 0.508, "unit": null}]}],
      "findings": [{"kind": "solution_mismatch", "text": "Ex. 7.1: 46.5% vs 50.8%.",
        "sources": ["cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002",
          "cccccccc-0000-0000-0000-000000000003"]}]}',
    '{}', '{}'),
  true, 'a running build writes its exercises and findings');
reset role;

select results_eq(
  $$select name, position, task_type, solution_status, solution, difficulty::int, final_answers
    from public.exercises where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by position$$,
  $$values ('Ex. 7.1', 0, 'compute thermal efficiency', 'disputed', null::text, 3,
    '[{"label": "Thermal efficiency", "value": 0.508, "unit": null}]'::jsonb)$$,
  'exercises are stored in order with their final answers, without one whose chunk is gone');
select results_eq(
  $$select k.name from public.exercise_kcs x join public.kcs k on k.id = x.kc_id
    where x.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by k.position$$,
  $$values ('Thermal efficiency'), ('Propulsive power')$$,
  'an exercise''s KCs point to the stored KCs');
select is((select origin from public.kcs where name = 'Propulsive power'), 'exercise',
  'a KC can come from an exercise');
select results_eq(
  $$select f.text, (select count(*)::int from public.finding_sources s where s.finding_id = f.id)
    from public.findings f$$,
  $$values ('Ex. 7.1: 46.5% vs 50.8%.', 2)$$,
  'a finding is stored with its existing sources');

select throws_ok(
  $$insert into public.exercises (owner, course_id, question_chunk_id, name, task_type,
      solution_status, solution, difficulty, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000001', 'Ex. 1', 'compute', 'verified', 'stored', 1, 5)$$,
  '23514', null, 'only a generated solution is stored');

-- Owners only, and Students cannot write.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.exercises) + (select count(*)::int from public.exercise_kcs)
    + (select count(*)::int from public.findings) + (select count(*)::int from public.finding_sources),
  0, 'another Student reads no exercises or findings');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.findings), 1, 'the owner reads their findings');
select throws_ok(
  $$delete from public.findings$$,
  '42501', null, 'a Student cannot delete a finding');
reset role;

select * from finish();
rollback;
