-- Assumptions as text (#249): the Prerequisite check stores what no KC
-- means on the assuming KC, unique by name, removes what it matches again,
-- and a KC retires once its sources are gone. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');
insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Lecture 1', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');
select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001',
  '[{"position": 0, "parent_position": null, "depth": 0, "title": "Lecture 1", "page_from": 1}]',
  '[{"position": 0, "page_from": 1, "page_to": 1, "label": "content", "markdown": "Bases.", "chapter_position": 0},
    {"position": 1, "page_from": 1, "page_to": 1, "label": "content", "markdown": "Ranks.", "chapter_position": 0}]');
insert into public.chapter_extractions (id, chapter_id, owner, course_id, kind, unit, content_hash, output, kc_ids)
select 'eeeeeeee-0000-0000-0000-000000000001', id, owner, course_id, 'content', 0, repeat('a', 64),
  '{"kcs": [], "prerequisites": []}', '{}'
from public.chapters where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.kcs (id, owner, course_id, name, description, origin, position)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Basis', 'A spanning independent family.', 'content', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Rank', 'The dimension of the image.', 'content', 1);
insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
select k.id, c.id, k.owner, k.course_id
from public.kcs as k
join public.chunks as c on c.course_id = k.course_id
  and c.markdown = case k.name when 'Basis' then 'Bases.' else 'Ranks.' end
where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Rank builds on Basis; Basis assumes Field twice and Sets, which no KC means.
select is(
  public.store_assumed_prerequisites('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000002"}]',
    '[{"kc": "bbbbbbbb-0000-0000-0000-000000000001", "name": "Field", "description": "A set with + and *."},
      {"kc": "bbbbbbbb-0000-0000-0000-000000000001", "name": " field", "description": "Again."},
      {"kc": "bbbbbbbb-0000-0000-0000-000000000001", "name": "Sets", "description": "Collections."}]',
    '[]', '{eeeeeeee-0000-0000-0000-000000000001}'),
  true, 'the running build stores what KCs assume');
select is(
  (select assumes from public.kcs where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  '[{"name": "Field", "description": "A set with + and *."}, {"name": "Sets", "description": "Collections."}]'::jsonb,
  'what no KC means stays on the assuming KC as text, once per name');
select results_eq(
  $$select (select count(*)::int from public.prerequisite_links where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
      assumes_matched from public.chapter_extractions where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values (1, true)$$,
  'the Prerequisite is stored and the extraction marked matched');

-- A merged KC assumes Sets again and Groups; Field is matched later.
select is(
  public.store_assumed_prerequisites('aaaaaaaa-0000-0000-0000-000000000001', '[]',
    '[{"kc": "bbbbbbbb-0000-0000-0000-000000000001", "name": "SETS", "description": "Other words."},
      {"kc": "bbbbbbbb-0000-0000-0000-000000000001", "name": "Groups", "description": "One operation."}]',
    '[{"kc": "bbbbbbbb-0000-0000-0000-000000000001", "name": "field "}]', '{}'),
  true, 'the running build matches again');
select is(
  (select jsonb_path_query_array(assumes, '$[*].name') from public.kcs where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  '["Sets", "Groups"]'::jsonb,
  'a matched name goes, and new names join by name');

-- Basis's chunk goes: it retires at once, though Rank builds on it.
delete from public.kc_sources where kc_id = 'bbbbbbbb-0000-0000-0000-000000000001';
insert into public.topics (owner, course_id, name, position, central_question, chapter_ids)
select owner, course_id, 'Bases', 0, 'Why?', array[id] from public.chapters
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.topic_kcs (topic_id, kc_id, owner, position)
select t.id, k.id, t.owner, k.position
from public.topics as t join public.kcs as k on k.course_id = t.course_id
where t.course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(public.retire_unsourced_kcs('aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'a KC whose sources are gone retires, whatever builds on it');
select results_eq(
  $$select k.name from public.topic_kcs as t join public.kcs as k on k.id = t.kc_id
    where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values ('Rank'::text)$$,
  'the retired KC leaves its Topic');

select * from finish();
rollback;
