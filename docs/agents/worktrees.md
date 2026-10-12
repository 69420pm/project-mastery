# Working in an agent worktree

An agent worktree is a checkout under `.claude/worktrees/`. Agents work in one while the user works in the main checkout. There are two kinds:

- **`/build`** (the default): the coordinator session enters one worktree for a spec, and `builder` agents work in it one after another, one slice each.
- **`/implement-spec`** (for large specs whose tickets don't overlap): each `implementer` gets its own worktree, and several run in parallel.

These rules keep agents from blocking each other or the user, and keep each agent's context small.

## Setup

For `/build`, the coordinator runs `tools/build/setup.sh <spec-issue>` once, right after entering the worktree. It names the branch after the spec, installs dependencies and links `.env.local`, so builders start working directly.

For `/implement-spec`, the first command in a new worktree is `tools/spec-run/setup-worktree.sh <integration-branch> <work-id>`, where the work id is the ticket number, or a short name such as `review-spec` for other work. It puts the worktree on the branch `<integration-branch>-<work-id>` based on the integration branch, installs dependencies, links `.env.local` and, for a ticket, prints the ticket brief. `pnpm` and `node` are on PATH as they are.

## Commands

Claude Code's worktree guard reads each Bash command before it runs and refuses one whose program, directory or git target is computed at runtime. Write every command with literal arguments, one command per call, run from the worktree root: `pnpm test:run src/features/chat`, `git switch -c feat/22-chat-23 feat/22-chat`. A pipe between literal commands is fine. `eval`, `$(…)`, shell variables, loops, `xargs` and `find -exec` get refused.

Change files with the Write and Edit tools, several Edit calls in one turn for batch edits. They run the lint hook, which fixes formatting and blocks on lint errors on every edit; warnings such as unused variables wait for `pnpm check`. The Bash guard refuses shell writes (`cat >`, `tee`, `sed -i`, Python patch scripts) in worktrees, because they skip the hook.

## Reading

Every turn re-reads the whole context, so read only what the task needs. In `/build` that is the one-page spec, the handoff maps of earlier slices, and files by the line ranges you need, found with `grep -n` first. In `/implement-spec` it is the ticket brief instead of the spec (`tools/spec-run/ticket-brief.sh <ticket>`, printed by the setup). The brief ends with the spec's headings and the command that reads one more section.
Library and environment gotchas verified in earlier work are in `docs/agents/notes/`. When you verify one that future work will need, add it there in a few lines, as part of your commit.

## Shared resources

All checkouts share one local Supabase, the user's AI quota and the machine's ports.

- **Database**: apply migrations with `pnpm exec supabase migration up --local --include-all`. A reset wipes other agents' data, so the Bash guard refuses it. The database can hold other tickets' tables, so after `pnpm db:types` keep only the changes for your own migrations in `database.types.ts`.
- **AI**: tests and runtime checks use `AI_PROVIDER=mock`. What live calls are allowed, and how, is in [live-ai.md](live-ai.md).
- **Ports**: `pnpm -s agent up` and Playwright pick a port for each checkout. Leave `PORT` unset.

## Tests

`pnpm test:e2e` rebuilds the app first when the code is newer than the last build. Run a new or changed e2e spec once before you finish. If it fails even once, run it with `--repeat-each=5`: a test that sometimes fails is a product bug, usually a race, until you have shown otherwise: find what the test observed in the window where it failed before you change the test.

## Git

Commit on your branch. In `/build`, the coordinator pushes and opens the PR. In `/implement-spec`, the orchestrator merges, pushes and opens PRs. Commands that discard uncommitted work are refused; discard single files by name.
