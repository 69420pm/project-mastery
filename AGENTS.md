<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product vision

[VISION.md](VISION.md) defines what this product is and what it is not. Read it before any product, UX or scope decision: proposing or planning features, writing issues, designing flows, UI or AI tutor behavior, or deciding between options that change what the user experiences. It is not needed for purely technical work such as implementing a well-specified issue, refactoring, fixing bugs, tooling or code review.

For the same decisions, check `research/design-rules/` for evidence-graded rules for learning and tutoring behavior. Research itself runs in sessions started from `research/`.

## Architecture

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) records the stack, and [docs/adr/](docs/adr/) the technical decisions behind it, one ADR each. Read them before adding a dependency, introducing a new service or pattern, or changing how data, auth, AI calls or background jobs work. Changing a recorded decision means updating its ADR, or superseding it with a new one, in the same PR.

Where code goes is defined in [Project structure](docs/ARCHITECTURE.md#project-structure) and enforced by ESLint. Read that section before creating files or folders. When a lint error reports a boundary or structure violation, move the code to where the message says; do not disable the rule or add exceptions.

## Library docs

Like Next.js, these packages ship documentation that matches the installed version. Read it before writing code against them instead of relying on memory:

- AI SDK: `node_modules/ai/docs/`, and `node_modules/@ai-sdk/<provider>/docs/` for providers
- Vercel Workflow: `node_modules/workflow/docs/`
- Supabase client: `node_modules/@supabase/supabase-js/AGENTS.md`

Gotchas that earlier work verified live in `docs/agents/notes/<topic>.md`: read the note for a library too, when there is one.

## Agent worktrees

In an agent worktree (`.claude/worktrees/`), read [docs/agents/worktrees.md](docs/agents/worktrees.md) before your first command: it covers setup, the commands the worktree guard accepts, and the database, AI quota and ports that parallel agents share.

## Git workflow

- Branches: `<type>/<kebab-description>` (feat, fix, docs, chore, refactor)
- Conventional Commits for commit messages and PR titles
- Specs and tickets are GitHub issues: read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) before creating, reading or closing one.
- Every change goes through a PR against `main`; never push to `main` or merge PRs. The maintainer reviews and squash-merges, so the PR title becomes the commit on `main`.
