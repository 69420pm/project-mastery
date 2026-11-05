<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product vision

[VISION.md](VISION.md) defines what this product is and what it is not. Read it before any product, UX or scope decision: proposing or planning features, writing issues, designing flows, UI or AI tutor behavior, or deciding between options that change what the user experiences. It is not needed for purely technical work such as implementing a well-specified issue, refactoring, fixing bugs, tooling or code review.

## Domain language

Name domain concepts in code, issues and UI with the terms in [GLOSSARY.md](GLOSSARY.md), and avoid the synonyms it lists.

## Architecture

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) records the stack, and [docs/adr/](docs/adr/) the technical decisions behind it, one ADR each. Read them before adding a dependency, introducing a new service or pattern, or changing how data, auth, AI calls or background jobs work. Changing a recorded decision means updating its ADR, or superseding it with a new one, in the same PR.

Where code goes is defined in [Project structure](docs/ARCHITECTURE.md#project-structure) and enforced by ESLint. Read that section before creating files or folders. When a lint error reports a boundary or structure violation, move the code to where the message says; do not disable the rule or add exceptions.

## Knowledge map and tutoring

[docs/features/knowledge-map.md](docs/features/knowledge-map.md) and [docs/features/tutoring.md](docs/features/tutoring.md) describe how both systems work: data flow, model calls, how prompts get built. Read them before changing parsing, the map build, the AI's prompt, context or tools, or scheduling, and update them in the same PR.

## Library docs

Like Next.js, these packages ship documentation that matches the installed version. Read it before writing code against them instead of relying on memory:

- AI SDK: `node_modules/ai/docs/`, and `node_modules/@ai-sdk/<provider>/docs/` for providers
- Vercel Workflow: `node_modules/workflow/docs/`
- Supabase client: `node_modules/@supabase/supabase-js/AGENTS.md`

Gotchas that earlier work verified live in `docs/agents/notes/<topic>.md`: read the note for a library too, when there is one.

## Agent harness

[docs/agents/harness.md](docs/agents/harness.md) sets how this repo equips agents. Read it before changing skills, agent definitions, hooks, `tools/` or `docs/agents/`.

## Agent worktrees

In an agent worktree (`.claude/worktrees/`), read [docs/agents/worktrees.md](docs/agents/worktrees.md) before your first command: it covers setup, the commands the worktree guard accepts, and the database, AI quota and ports that parallel agents share.

## Git workflow

- Conventional Commits for commit messages and PR titles.
- Every change goes through a PR against `main`; never push to `main` or merge PRs. Read [docs/agents/pull-requests.md](docs/agents/pull-requests.md) before creating a branch or opening a PR.
- Specs are GitHub issues: read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) before creating, reading or closing one.

## Live AI calls

Tests and app runs use `AI_PROVIDER=mock`. Read [docs/agents/live-ai.md](docs/agents/live-ai.md) before any command that calls a real model: a smoke check or a single provider call.

## Staging database

`pnpm -s agent staging "<table>?<params>"` reads rows of the staging project, which holds real data, and `pnpm -s agent staging-sql "<query>"` runs one read-only SQL statement there. Nothing writes to staging: its role can only read, and migrations reach it on merge to `main`. Read [ADR 0025](docs/adr/0025-staging-for-agent-review-and-migrations.md) first.
