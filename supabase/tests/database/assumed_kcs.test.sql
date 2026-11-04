-- KCs without sources (#236): the Prerequisite check stores the KCs the
-- Materials assume with their links, and retirement keeps a KC without
-- sources while a live KC builds on it. Run with `pnpm db:test`.
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
from public.chapters;

create function pg_temp.vec(axis int) returns extensions.vector language sql as $$
  select ('[' || array_to_string(array_agg(case when i = axis then 1 else 0 end order by i), ',') || ']')::extensions.vector
  from generate_series(1, 2048) as i
$$;

-- Basis and Rank are taught; Span was retired earlier.
insert into public.kcs (id, owner, course_id, name, description, origin, position, embedding, retired_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Basis', 'A spanning independent family.', 'content', 0, pg_temp.vec(1), null),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Rank', 'The dimension of the image.', 'content', 1, pg_temp.vec(2), null),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Span', 'All linear combinations.', 'content', 2, pg_temp.vec(3), now());
insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
select k.id, c.id, k.owner, k.course_id
from public.kcs as k
join public.chunks as c on c.markdown = case k.name when 'Basis' then 'Bases.' else 'Ranks.' end
where k.name in ('Basis', 'Rank');

-- Basis assumes Field, which no KC means, and Span; Rank builds on Basis.
select is(
  public.store_assumed_prerequisites('aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001', 'new', true,
        'name', 'Field', 'description', 'A set with addition and multiplication.',
        'embedding', pg_temp.vec(4)::text),
      jsonb_build_object('id', 'bbbbbbbb-0000-0000-0000-000000000003', 'new', false)),
    '[{"from": "cccccccc-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000001"},
      {"from": "bbbbbbbb-0000-0000-0000-000000000003", "to": "bbbbbbbb-0000-0000-0000-000000000001"},
      {"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000002"}]',
    '{eeeeeeee-0000-0000-0000-000000000001}'),
  true, 'the running build stores the assumed KCs');
select results_eq(
  $$select name, origin, position, retired_at is null, embedding is not null,
      (select count(*)::int from public.kc_sources as s where s.kc_id = k.id)
    from public.kcs as k order by position$$,
  $$values ('Basis'::text, 'content'::text, 0, true, true, 1), ('Rank', 'content', 1, true, true, 1),
    ('Span', 'content', 2, true, true, 0), ('Field', 'content', 3, true, true, 0)$$,
  'a new KC without sources comes after the others with its vector, and the retired one lives again');
select is((select count(*)::int from public.prerequisite_links), 3, 'the links are stored');

-- Basis's Material goes: Basis builds a chain on Field and Span, and Rank on Basis.
delete from public.kc_sources where kc_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select is(public.retire_unsourced_kcs('aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'KCs without sources that a live KC builds on, directly or through others, stay');

-- Rank goes too: the whole chain retires at once.
delete from public.kc_sources where kc_id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.topics (owner, course_id, name, position, central_question, chapter_ids)
select owner, course_id, 'Bases', 0, 'Why?', array[id] from public.chapters;
insert into public.topic_kcs (topic_id, kc_id, owner, position)
select t.id, k.id, t.owner, k.position from public.topics as t cross join public.kcs as k;
select is(public.retire_unsourced_kcs('aaaaaaaa-0000-0000-0000-000000000001'), 4,
  'without a live KC building on them, KCs without sources retire along the chain');
select is((select count(*)::int from public.kcs where retired_at is null), 0, 'none is left live');
select is((select count(*)::int from public.topic_kcs), 0, 'retired KCs leave their Topic');

select * from finish();
rollback;
