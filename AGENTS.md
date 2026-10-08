<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product vision

[VISION.md](VISION.md) defines what this product is and what it is not. Read it before any product, UX or scope decision: proposing or planning features, writing issues, designing flows, UI or AI tutor behavior, or deciding between options that change what the user experiences. It is not needed for purely technical work such as implementing a well-specified issue, refactoring, fixing bugs, tooling or code review.

## Architecture

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) records the stack, and [docs/adr/](docs/adr/) the technical decisions behind it, one ADR each. Read them before adding a dependency, introducing a new service or pattern, or changing how data, auth, AI calls or background jobs work. Changing a recorded decision means updating its ADR, or superseding it with a new one, in the same PR.

Where code goes is defined in [Project structure](docs/ARCHITECTURE.md#project-structure) and enforced by ESLint. Read that section before creating files or folders. When a lint error reports a boundary or structure violation, move the code to where the message says; do not disable the rule or add exceptions.

## Library docs

Like Next.js, these packages ship documentation that matches the installed version. Read it before writing code against them instead of relying on memory:

- AI SDK: `node_modules/ai/docs/`, and `node_modules/@ai-sdk/<provider>/docs/` for providers
- Vercel Workflow: `node_modules/workflow/docs/`
- Supabase client: `node_modules/@supabase/supabase-js/AGENTS.md`

## Skills

`.claude/skills/` holds the official skills for Supabase, shadcn/ui and Langfuse, and Matt Pocock's engineering skills (`mattpocock/skills`). They are installed with the `skills` CLI and pinned in `skills-lock.json`. Update them with `npx skills update -p` and review the diff. To adapt one, remove it from `skills-lock.json` so updates leave it alone, and mark it _modified_ in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Before exploring code for a skill, read [docs/agents/domain.md](docs/agents/domain.md): how to use the domain glossary and the ADRs.

`run-app` is this project's own skill: how to run, drive and verify the app with `pnpm -s agent` (`tools/agent/`). Use it to confirm that a change works in the running app, not only that it compiles. It is not in `skills-lock.json`: keep it in sync when you change `tools/agent/`.

Chat UI is built with AI Elements (`src/components/ai-elements/`, [ADR 0011](docs/adr/0011-shadcn-ui-with-own-design.md)), not with the chat components the shadcn skill recommends.

## Git workflow

- Branches: `<type>/<kebab-description>` (feat, fix, docs, chore, refactor)
- Conventional Commits for commit messages and PR titles
- Specs and tickets are GitHub issues: read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) before creating, reading or closing one.
- Every change goes through a PR against `main`; never push to `main` or merge PRs. The maintainer reviews and squash-merges, so the PR title becomes the commit on `main`.
- No AI attribution: no `Co-Authored-By` trailers or "Generated with" lines in commits or PRs.
