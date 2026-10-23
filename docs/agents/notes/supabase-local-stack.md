# Local Supabase stack

- The stack's containers bind-mount files (such as `supabase/templates/*.html` into Kong) from the checkout that ran `supabase start`. When that checkout was a worktree that is later removed, Kong can no longer start: `agent up` fails with `ECONNREFUSED 127.0.0.1:54321`, `supabase status` lists Kong as stopped, and `supabase start` does not restart it.
- Fix: `pnpm db:stop`, then `pnpm -s agent up`. `supabase stop` keeps the data (it backs up the volumes by default); it only interrupts other checkouts for the restart. `docker rm` of the Kong container alone does not help: `supabase start` does not recreate it.
