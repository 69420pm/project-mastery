# Contributing

The [live deployment](https://project-mastery-dun.vercel.app) is the quickest way to try the app. This page is for running it locally and for changing it. The project's code is under the [PolyForm Noncommercial License](LICENSE).

## Run it locally

Requires Node.js 24 (see `.nvmrc`) and pnpm (pinned via the `packageManager` field; `corepack enable` sets it up).

```bash
corepack enable
pnpm install
cp .env.example .env.local
```

Then set up the database and the AI keys below, and start the app with `pnpm dev` at [http://localhost:3000](http://localhost:3000).

### Local Supabase

Auth, the database and file storage run locally with the Supabase CLI (installed with the dev dependencies). It needs Docker, for example [Docker Desktop](https://docs.docker.com/desktop/) or [OrbStack](https://orbstack.dev).

```bash
pnpm db:start   # start Supabase in Docker and apply the migrations
pnpm db:status  # print the local URL and API keys
```

Copy the Project URL, the Publishable key and the Secret key from `pnpm db:status` into `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in `.env.local`, then restart `pnpm dev`. Sign up at [/login](http://localhost:3000/login); confirmation and sign-in emails land in Mailpit at [http://127.0.0.1:54324](http://127.0.0.1:54324). Studio runs at [http://127.0.0.1:54323](http://127.0.0.1:54323).

<details>
<summary>Docker on Linux, including an OrbStack Linux machine</summary>

Install [Docker Engine](https://docs.docker.com/engine/install/) and add yourself to the `docker` group. If image pulls fail with "failed to convert whiteout file" on a btrfs root (as in OrbStack machines), set `{ "features": { "containerd-snapshotter": false }, "storage-driver": "btrfs" }` in `/etc/docker/daemon.json` and restart Docker.

</details>

Schema changes are SQL migrations in `supabase/migrations/`:

```bash
pnpm db:migration:new add_courses  # create an empty migration file
pnpm db:reset                      # rebuild the local database from migrations and seed.sql
pnpm db:types                      # regenerate src/lib/supabase/database.types.ts
pnpm db:test                       # run the Row Level Security tests in supabase/tests/
```

Every new table needs Row Level Security policies and pgTAP tests for them ([ADR 0003](docs/adr/0003-supabase-js-with-rls.md)). Commit the regenerated types with the migration; CI fails when they are out of date.

### AI, background jobs and tracing

- **AI keys:** deployments call models through Vercel AI Gateway. Locally, the text tasks call the Gemini API directly: create a `GOOGLE_GENERATIVE_AI_API_KEY` in [Google AI Studio](https://aistudio.google.com/apikey) and set the `AI_MODEL_*` overrides in `.env.local` that `.env.example` lists, which point them at `google/gemini-3.5-flash-lite` ([ADR 0016](docs/adr/0016-gemini-api-for-local-development.md)). Embeddings still need an `AI_GATEWAY_API_KEY` from the [Vercel dashboard](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys), which every team gets a monthly free credit for. Use your own test materials and never personal data. Unit tests and CI use mock models and need no key. Models are configured per task in `src/lib/ai/models.ts`.
- **Mock AI:** `AI_PROVIDER=mock` answers every AI call with a deterministic reply, streamed slowly enough to be stopped, without any key or network access. The Playwright suite runs the production build in this mode; it is refused on Vercel.
- **Background jobs:** `pnpm dev` runs workflows locally with no setup (the local world stores runs in `.next/workflow-data`). Inspect runs with `pnpm exec workflow web` or `pnpm exec workflow inspect runs`.
- **Tracing (optional):** create a project in [Langfuse EU cloud](https://cloud.langfuse.com) and set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to trace every real AI call (not the mock provider's). Without keys, tracing is off.
- **Evals:** `pnpm evals` runs the eval datasets in `evals/` against real models, as the AI keys above route them. With Langfuse keys, results are recorded as dataset runs. Run them before changing a prompt or model; they never run in CI. Judge criteria are rubrics in `evals/judges/`: `pnpm evals draft <criterion> [--limit N]` judges recent Chat replies in Langfuse, writes the verdicts as `<criterion>_draft` scores and adds the traces to the `tutor-criteria` annotation queue for labelling; `pnpm evals calibrate <criterion>` runs each judge candidate on the labelled traces and prints its agreement and the winner.

### Agent CLI

`pnpm -s agent` lets coding agents (and you) drive the running app from the terminal: start the stack, sign in as a test user, open pages as compact accessibility snapshots, click and type, read errors as Next.js sees them, follow emails and run SQL with Row Level Security applied. It works only against the local stack. `pnpm -s agent help` lists the commands; the `run-app` skill in `.claude/skills/` teaches agents the workflow.

```bash
pnpm -s agent up              # start Supabase and the dev server, create test users
pnpm -s agent login student   # sign in the browser session as a test user
pnpm -s agent open /courses   # URL, page snapshot and new errors
pnpm -s agent check           # compile issues, runtime and server errors
```

## Scripts

| Command                        | Description                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm dev`                     | Start the dev server                                                               |
| `pnpm build`                   | Production build                                                                   |
| `pnpm start`                   | Serve the production build                                                         |
| `pnpm lint`                    | ESLint (zero warnings allowed)                                                     |
| `pnpm lint:fix`                | ESLint with autofix                                                                |
| `pnpm typecheck`               | Generate route types and run `tsc`                                                 |
| `pnpm format`                  | Format with Prettier                                                               |
| `pnpm test`                    | Unit tests in watch mode                                                           |
| `pnpm test:run`                | Unit tests once                                                                    |
| `pnpm test:coverage`           | Unit tests with coverage report                                                    |
| `pnpm test:e2e`                | Playwright E2E tests (run `pnpm db:start` first; rebuilds when the build is stale) |
| `pnpm check`                   | Lint + typecheck + format check + unit tests                                       |
| `pnpm evals`                   | AI evals against real models (not in CI)                                           |
| `pnpm smoke <name>`            | Run one feature path once against a real model and check it (not in CI)            |
| `pnpm langfuse:models`         | Push the model prices in `src/lib/ai/prices.ts` to Langfuse                        |
| `pnpm -s agent`                | Drive the running app from the terminal                                            |
| `pnpm -s retro`                | Digest recent Claude Code runs of this repo for a retro                            |
| `pnpm -s sweep`                | Deterministic checks for `/sweep` (`mutate [unit...]` runs mutation tests)         |
| `pnpm db:start`                | Start local Supabase (Docker)                                                      |
| `pnpm db:stop`                 | Stop local Supabase                                                                |
| `pnpm db:status`               | Show local Supabase URLs and API keys                                              |
| `pnpm db:reset`                | Recreate the local database from migrations                                        |
| `pnpm db:migration:new <name>` | Create a new SQL migration file                                                    |
| `pnpm db:types`                | Generate TypeScript types from the local DB                                        |
| `pnpm db:lint`                 | Lint the local database schema                                                     |
| `pnpm db:test`                 | Run pgTAP database tests (RLS policies)                                            |

## Where code goes

The layers, the anatomy of a feature and the lint rules that enforce them are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#project-structure). Read that section before creating files or folders.

## Workflow

1. Pick or open an issue. Use the templates — they keep acceptance criteria explicit.
2. Create a branch from `main`: `feat/12-user-profile`, `fix/34-login-redirect`, `chore/...`.
3. Make your change with tests. Run `pnpm check` before pushing; a pre-commit hook lints and formats staged files.
4. Open a pull request and link the issue (`Closes #12`). Vercel posts a preview URL.
5. The PR title must follow [Conventional Commits](https://www.conventionalcommits.org) — PRs are squash-merged, so the title becomes the commit on `main` and feeds the changelog.
6. Merging into `main` deploys to production. release-please then opens a release PR with a generated changelog; merging it tags a version.

| Prefix      | Use for                             | Version bump |
| ----------- | ----------------------------------- | ------------ |
| `feat:`     | New user-facing functionality       | minor        |
| `fix:`      | Bug fixes                           | patch        |
| `perf:`     | Performance improvements            | patch        |
| `refactor:` | Code change without behavior change | —            |
| `test:`     | Tests only                          | —            |
| `docs:`     | Documentation only                  | —            |
| `ci:`       | CI/CD configuration                 | —            |
| `chore:`    | Tooling, dependencies, housekeeping | —            |

Add `!` (e.g. `feat!:`) for breaking changes.

## Required checks

`main` is protected. A PR can be merged only when these pass:

- Lint, typecheck & unit tests
- Build & E2E tests
- CodeQL
- Conventional Commits PR title

## Testing

- **Unit / component tests** live next to the code as `*.test.ts(x)` and run with Vitest.
- **End-to-end tests** live in `e2e/` and run with Playwright against the production build, with mock AI (`AI_PROVIDER=mock`) and local Supabase:
  ```bash
  pnpm exec playwright install chromium   # once
  pnpm db:start
  pnpm test:e2e   # rebuilds first when the code is newer than the last build
  ```
  For a signed-in test, import `test` and `expect` from `e2e/fixtures.ts` and use the `student` fixture: it creates a fresh Student through the local auth admin API and starts the test signed in. These tests skip when `PLAYWRIGHT_BASE_URL` points at a deployment.
