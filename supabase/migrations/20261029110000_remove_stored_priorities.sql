-- Priority is computed when read (#224, slice 2 of #222): from old exams,
-- Exercises and the Brief, in code. Removes the priority runs, the stored
-- KC priorities and their functions.

drop function public.queue_priority_run(uuid);
drop function public.record_priority_run_start_failure(uuid);
drop function public.replace_kc_priorities(uuid, jsonb, jsonb);

drop table public.kc_priorities;
drop table public.priority_runs;
