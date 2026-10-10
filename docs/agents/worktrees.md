# Working in an agent worktree

An agent worktree is a checkout under `.claude/worktrees/` that one subagent works in while other agents work in parallel beside it. These rules keep parallel agents from blocking each other and keep each agent's context small.

## Setup

The first command in a new worktree is `tools/spec-run/setup-worktree.sh <integration-branch> <work-id>`, where the work id is the ticket number, or a short name such as `review-spec` for other work. It puts the worktree on the branch `<integration-branch>-<work-id>` based on the integration branch, installs dependencies, links `.env.local` and, for a ticket, prints the ticket brief. `pnpm` and `node` are on PATH as they are.

## Commands

Claude Code's worktree guard reads each Bash command before it runs and refuses one whose program, directory or git target is computed at runtime. Write every command with literal arguments, one command per call, run from the worktree root: `pnpm test:run src/features/chat`, `git switch -c feat/22-chat-23 feat/22-chat`. A pipe between literal commands is fine. `eval`, `$(…)`, shell variables, loops, `xargs` and `find -exec` get refused.

Change files with the Write and Edit tools, several Edit calls in one turn for batch edits. They run the lint hook, which fixes formatting and blocks on lint errors on every edit; warnings such as unused variables wait for `pnpm check`. The Bash guard refuses shell writes (`cat >`, `tee`, `sed -i`, Python patch scripts) in worktrees, because they skip the hook.

## Reading

Every turn re-reads the whole context, so read what the task needs: the ticket brief (`tools/spec-run/ticket-brief.sh <ticket>`, printed by the setup), the handoff maps of earlier tickets, and files by the range you need, found with `grep -n` first. The brief ends with the spec's headings and the command that reads one more section.
Library and environment gotchas verified in earlier work are in `docs/agents/notes/`. When you verify one that future work will need, add it there in a few lines, as part of your commit.

## Shared resources

All checkouts share one local Supabase, the user's AI quota and the machine's ports.

- **Database**: apply migrations with `pnpm exec supabase migration up --local --include-all`. A reset wipes other agents' data, so the Bash guard refuses it. The database can hold other tickets' tables, so after `pnpm db:types` keep only the changes for your own migrations in `database.types.ts`.
- **AI**: tests and runtime checks use `AI_PROVIDER=mock`. Evals and live model calls spend the user's free-tier quota (20 requests per flash model per day, see [the Gemini free-tier note](notes/gemini-free-tier.md)), so they run once at the end of a spec, by the orchestrator, after the user agrees.
- **Ports**: `pnpm -s agent up` and Playwright pick a port for each checkout. Leave `PORT` unset.

## Tests

`pnpm test:e2e` rebuilds the app first when the code is newer than the last build. Run a new or changed e2e spec with `pnpm test:e2e --repeat-each=5 <spec>` before you finish. A test that sometimes fails is a product bug, usually a race, until you have shown otherwise: find what the test observed in the window where it failed before you change the test.

## Git

Commit on your ticket branch. The orchestrator merges, pushes and opens PRs. Commands that discard uncommitted work are refused; discard single files by name.
