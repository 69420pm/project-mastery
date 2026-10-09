# Working in an agent worktree

An agent worktree is a checkout under `.claude/worktrees/` that one subagent works in while other agents work in parallel beside it. These rules keep parallel agents from blocking each other and keep each agent's context small.

## Setup

The first command in a new worktree is `tools/spec-run/setup-worktree.sh <integration-branch> <ticket-number>`. It puts the worktree on the ticket branch based on the integration branch, installs dependencies and links `.env.local`. `pnpm` and `node` are on PATH as they are.

## Commands

Claude Code's worktree guard reads each Bash command before it runs and refuses one whose program, directory or git target is computed at runtime. Write every command with literal arguments, one command per call, run from the worktree root: `pnpm test:run src/features/chat`, `git switch -c feat/22-chat-23 feat/22-chat`. A pipe between literal commands is fine. `eval`, `$(…)`, shell variables, loops, `xargs` and `find -exec` get refused.

Edit files with the Edit and Write tools. They run the lint hook, which fixes formatting and reports lint errors on every edit, so you don't need to run lint or Prettier yourself.

## Reading

Every turn re-reads the whole context, so read what the task needs: the ticket, the spec sections it names, and files by the range you need. A spec's sections have stable `##` headings, so one section reads with:

```bash
gh issue view 22 --json body -q .body | sed -n '/^## Testing Decisions/,/^## /p'
```

Library and environment gotchas verified in earlier work are in `docs/agents/notes/`. When you verify one that future work will need, add it there in a few lines, as part of your commit.

## Shared resources

All checkouts share one local Supabase, the user's AI quota and the machine's ports.

- **Database**: apply migrations with `pnpm exec supabase migration up --local --include-all`. A reset wipes other agents' data, so the Bash guard refuses it. The database can hold other tickets' tables, so after `pnpm db:types` keep only the changes for your own migrations in `database.types.ts`.
- **AI**: tests and runtime checks use `AI_PROVIDER=mock`. Evals and live model calls spend the user's free-tier quota (about 10 requests per model per day), so they run once at the end of a spec, by the orchestrator, after the user agrees.
- **Ports**: `pnpm -s agent up` and Playwright pick a port for each checkout. Leave `PORT` unset.

## Tests

Run a new or changed e2e spec with `pnpm test:e2e --repeat-each=5 <spec>` before you finish. A test that sometimes fails is a product bug, usually a race, until you have shown otherwise: find what the test observed in the window where it failed before you change the test.

## Git

Commit on your ticket branch. The orchestrator merges, pushes and opens PRs. Commands that discard uncommitted work are refused; discard single files by name.
