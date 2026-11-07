-- General answer keys (#249 slice 2). An answer key is { label, value,
-- anyOrder }, its value a mathjs expression, so keys hold vectors,
-- matrices, complex numbers and expressions as well as numbers with units.
-- Keys of the old { label, value, unit } shape are deleted, in Exercises,
-- generated Problems and stored exercise extractions. A check of a value
-- against its key may now also be `unchecked`: a kind of value code does
-- not compare, or a key the value left out.

update public.exercises set final_answers = null where final_answers is not null;
update public.problems set final_answers = null where final_answers is not null;

update public.chapter_extractions
set output = jsonb_set(
  output,
  '{exercises}',
  (
    select coalesce(jsonb_agg(exercise || '{"finalAnswers": []}'::jsonb), '[]'::jsonb)
    from jsonb_array_elements(output -> 'exercises') as exercise
  )
)
where kind = 'exercise' and jsonb_typeof(output -> 'exercises') = 'array';

comment on column public.exercises.final_answers is 'The answer keys a Student''s final values are checked against: [{ label, value, anyOrder }], each value a mathjs expression. Null when the Exercise prints no mathematical result.';
comment on column public.problems.final_answers is 'The answer keys of the generated Problem, from its program: [{ label, value, anyOrder }], each value a mathjs expression. Null without any.';

alter table public.attempts
  drop constraint attempts_check_check,
  add constraint attempts_check_check
    check ("check" in ('match', 'mismatch', 'unchecked'));

comment on column public.attempts."check" is 'The worst check of the question''s final values against its keys: mismatch, unchecked (a value code does not compare, or a key without a value), or match. Null when the question has no keys.';

alter table public.mock_items
  drop constraint mock_items_check_check,
  add constraint mock_items_check_check
    check ("check" in ('match', 'mismatch', 'unchecked'));

comment on column public.mock_items."check" is 'The worst check of the item''s final values against its keys, as on attempts. Null when the item has no keys or no answer.';
