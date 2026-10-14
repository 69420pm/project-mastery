# Working in an agent worktree

An agent worktree is a checkout under `.claude/worktrees/`. `/build` works in one per spec: the coordinator session enters it, and `builder` agents work in it one after another, one slice each, while the user works in the main checkout. These rules keep agents from blocking each other or the user, and keep each agent's context small.

## Setup

The coordinator runs `tools/build/setup.sh <spec-issue>` once, right after entering the worktree. It names the branch after the spec, installs dependencies and links `.env.local`, so builders start working directly. `pnpm` and `node` are on PATH as they are.

## Commands

Claude Code's worktree guard reads each Bash command before it runs and refuses one whose program, directory or git target is computed at runtime. Write every command with literal arguments, one command per call, run from the worktree root: `pnpm test:run src/features/chat`. A pipe between literal commands is fine. `eval`, `$(…)`, shell variables, loops, `xargs` and `find -exec` get refused.

Change files with the Write and Edit tools, several Edit calls in one turn for batch edits. They run the lint hook, which fixes formatting and blocks on lint errors on every edit; warnings such as unused variables wait for `pnpm check`. The Bash guard refuses shell writes (`cat >`, `tee`, `sed -i`, Python patch scripts) in worktrees, because they skip the hook.

## Reading

Every turn re-reads the whole context, so read only what the task needs: the one-page spec, the handoff maps of earlier slices, and files by the line ranges you need, found with `grep -n` first.
Library and environment gotchas verified in earlier work are in `docs/agents/notes/`. When you verify one that future work will need, add it there in a few lines, as part of your commit.

## Shared resources

All checkouts share one local Supabase, the AI Gateway credit and the machine's ports.

- **Database**: apply migrations with `pnpm exec supabase migration up --local --include-all`. A reset wipes other checkouts' data, so the Bash guard refuses it. The database can hold other branches' tables, so after `pnpm db:types` keep only the changes for your own migrations in `database.types.ts`.
- **AI**: tests and runtime checks use `AI_PROVIDER=mock`. What live calls are allowed, and how, is in [live-ai.md](live-ai.md).
- **Ports**: `pnpm -s agent up` and Playwright pick a port for each checkout. Leave `PORT` unset.

## Tests

`pnpm test:e2e` rebuilds the app first when the code is newer than the last build. Run a new or changed e2e spec once before you finish. If it fails even once, run it with `--repeat-each=5`: a test that sometimes fails is a product bug, usually a race, until you have shown otherwise: find what the test observed in the window where it failed before you change the test.

## Git

Builders commit on the branch; the coordinator pushes and opens the PR. Commands that discard uncommitted work are refused; discard single files by name.
