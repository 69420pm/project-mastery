# Project Mastery

[![CI](https://github.com/69420pm/project-mastery/actions/workflows/ci.yml/badge.svg)](https://github.com/69420pm/project-mastery/actions/workflows/ci.yml)
[![CodeQL](https://github.com/69420pm/project-mastery/actions/workflows/codeql.yml/badge.svg)](https://github.com/69420pm/project-mastery/actions/workflows/codeql.yml)

**Live demo:** https://project-mastery-dun.vercel.app

> 🚧 Early development — the product description lands here as features ship.

## Tech stack

| Area             | Choice                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| Framework        | [Next.js](https://nextjs.org) (App Router, React Compiler)               |
| Language         | TypeScript (strict)                                                      |
| Styling          | Tailwind CSS                                                             |
| Validation       | Zod (Server Action input, environment variables)                         |
| UI               | shadcn/ui (Radix), AI Elements, next-themes, own design tokens           |
| Math & documents | KaTeX, Streamdown (streaming markdown with math), react-pdf              |
| AI               | [Vercel AI SDK](https://ai-sdk.dev) through Vercel AI Gateway            |
| Background jobs  | [Vercel Workflow](https://useworkflow.dev) (durable workflows)           |
| LLM tracing      | [Langfuse](https://langfuse.com) via OpenTelemetry, on-demand evals      |
| Database         | Supabase Postgres with pgvector, Row Level Security, SQL migrations      |
| Auth and storage | Supabase Auth (email + password, magic link), Supabase Storage           |
| Data access      | supabase-js and `@supabase/ssr` with generated types                     |
| Unit tests       | Vitest + React Testing Library                                           |
| E2E tests        | Playwright                                                               |
| Code quality     | ESLint, Prettier, Husky + lint-staged                                    |
| CI/CD            | GitHub Actions, Vercel (preview deploy per PR, production from `main`)   |
| Security         | CodeQL, Dependabot, dependency review, secret scanning + push protection |
| Releases         | release-please (semantic versioning + generated changelog)               |
| Project tracking | GitHub Issues + Projects                                                 |

The table lists what is in place today. The rest of the planned stack (spaced repetition, error tracking, analytics, email) and the reasons behind each choice are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and its decision records in [docs/adr/](docs/adr/).

## Getting started

Requires Node.js 24 (see `.nvmrc`) and pnpm (pinned via the `packageManager` field — `corepack enable` sets it up).

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local Supabase

Auth, the database and file storage run locally with the Supabase CLI (installed with the dev dependencies). It needs Docker, for example [Docker Desktop](https://docs.docker.com/desktop/) or [OrbStack](https://orbstack.dev). On Linux, including an OrbStack Linux machine, install [Docker Engine](https://docs.docker.com/engine/install/) and add yourself to the `docker` group. If image pulls fail with "failed to convert whiteout file" on a btrfs root (as in OrbStack machines), set `{ "features": { "containerd-snapshotter": false }, "storage-driver": "btrfs" }` in `/etc/docker/daemon.json` and restart Docker.

```bash
pnpm db:start   # start Supabase in Docker and apply the migrations
pnpm db:status  # print the local URL and API keys
```

Copy the Project URL, the Publishable key and the Secret key from `pnpm db:status` into `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in `.env.local`, then restart `pnpm dev`. Sign up at [/login](http://localhost:3000/login); confirmation and sign-in emails land in Mailpit at [http://127.0.0.1:54324](http://127.0.0.1:54324). Studio runs at [http://127.0.0.1:54323](http://127.0.0.1:54323).

Schema changes are SQL migrations in `supabase/migrations/`:

```bash
pnpm db:migration:new add_courses  # create an empty migration file
pnpm db:reset                      # rebuild the local database from migrations and seed.sql
pnpm db:types                      # regenerate src/lib/supabase/database.types.ts
pnpm db:test                       # run the Row Level Security tests in supabase/tests/
```

Every new table needs Row Level Security policies and pgTAP tests for them ([ADR 0003](docs/adr/0003-supabase-js-with-rls.md)). Commit the regenerated types with the migration; CI fails when they are out of date.

### AI, background jobs and tracing

- **AI key:** local development calls the Gemini API directly (`AI_PROVIDER=google`, as in `.env.example`). Create a free key in [Google AI Studio](https://aistudio.google.com/apikey), no credit card needed, and set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`. Google may use free-tier prompts for training, so use your own test materials and never personal data. To go through Vercel AI Gateway instead, as deployments do, set `AI_PROVIDER=gateway` and an `AI_GATEWAY_API_KEY` from the [Vercel dashboard](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys). Unit tests and CI use mock models and need no key. Models are configured per task in `src/lib/ai/models.ts`.
- **Mock AI:** `AI_PROVIDER=mock` answers every AI call with a deterministic reply, streamed slowly enough to be stopped, without any key or network access. The Playwright suite runs the production build in this mode; it is refused on Vercel.
- **Background jobs:** `pnpm dev` runs workflows locally with no setup (the local world stores runs in `.next/workflow-data`). Inspect runs with `pnpm exec workflow web` or `pnpm exec workflow inspect runs`.
- **Tracing (optional):** create a project in [Langfuse EU cloud](https://cloud.langfuse.com) and set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to trace every AI call. Without keys, tracing is off.
- **Evals:** `pnpm evals` runs the eval datasets in `evals/` against real models (Gemini API free tier locally). With Langfuse keys, results are recorded as dataset runs. Run them before changing a prompt or model; they never run in CI.

### Agent CLI

`pnpm -s agent` lets coding agents (and you) drive the running app from the terminal: start the stack, sign in as a test user, open pages as compact accessibility snapshots, click and type, read errors as Next.js sees them, follow emails and run SQL with Row Level Security applied. It works only against the local stack. `pnpm -s agent help` lists the commands; the `run-app` skill in `.claude/skills/` teaches agents the workflow.

```bash
pnpm -s agent up              # start Supabase and the dev server, create test users
pnpm -s agent login student   # sign in the browser session as a test user
pnpm -s agent open /dashboard # URL, page snapshot and new errors
pnpm -s agent check           # compile issues, runtime and server errors
```

## Scripts

| Command              | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `pnpm dev`           | Start the dev server                                              |
| `pnpm build`         | Production build                                                  |
| `pnpm start`         | Serve the production build                                        |
| `pnpm lint`          | ESLint (zero warnings allowed)                                    |
| `pnpm typecheck`     | Generate route types and run `tsc`                                |
| `pnpm format`        | Format with Prettier                                              |
| `pnpm test`          | Unit tests in watch mode                                          |
| `pnpm test:coverage` | Unit tests with coverage report                                   |
| `pnpm test:e2e`      | Playwright E2E tests (run `pnpm build` and `pnpm db:start` first) |
| `pnpm check`         | Lint + typecheck + format check + unit tests                      |
| `pnpm evals`         | AI evals against real models (not in CI)                          |
| `pnpm -s agent`      | Drive the running app from the terminal                           |
| `pnpm db:start`      | Start local Supabase (Docker)                                     |
| `pnpm db:stop`       | Stop local Supabase                                               |
| `pnpm db:status`     | Show local Supabase URLs and API keys                             |
| `pnpm db:reset`      | Recreate the local database from migrations                       |
| `pnpm db:types`      | Generate TypeScript types from the local DB                       |
| `pnpm db:lint`       | Lint the local database schema                                    |
| `pnpm db:test`       | Run pgTAP database tests (RLS policies)                           |

## Development workflow

1. **Plan** — every change starts as an issue (bug / feature / task template) on the project board.
2. **Branch** — `feat/<issue>-short-name`, `fix/...`, `chore/...`.
3. **Commit** — a pre-commit hook lints and formats staged files.
4. **Pull request** — title follows [Conventional Commits](https://www.conventionalcommits.org); CI runs lint, typecheck, unit + E2E tests, CodeQL and dependency review; Vercel posts a preview URL.
5. **Merge** — squash-merge into protected `main` once checks pass; production deploys automatically.
6. **Release** — release-please opens a release PR with a generated changelog; merging it tags a version.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Project structure

```
src/app/           Routing only: Next.js pages, layouts and route handlers
src/features/      One folder per feature: components, server code, AI, workflows
src/components/    Shared components; ui/ and ai-elements/ are generated by their CLIs
src/hooks/         Shared client hooks
src/lib/           Platform: Supabase clients, auth session, AI config, tracing, env
eslint/            Lint rules that enforce the project structure, and their tests
evals/             AI eval datasets and runner (`pnpm evals`)
tools/agent/       CLI that lets coding agents drive the running app (`pnpm -s agent`)
supabase/          Supabase config, SQL migrations, seed data and pgTAP tests
docs/              Architecture; adr/ holds the technical decisions
e2e/               Playwright end-to-end tests
public/            Static assets
.github/           CI workflows, issue/PR templates, Dependabot
```

The layers, the anatomy of a feature and the lint rules that enforce them are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#project-structure).

## License

Copyright © 2026 Florian Portscher. All rights reserved.

The source is public for review purposes; no license is granted for reuse or redistribution.

Third-party agent skills in `.claude/skills/` keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
