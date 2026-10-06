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
| Unit tests       | Vitest + React Testing Library                                           |
| E2E tests        | Playwright                                                               |
| Code quality     | ESLint, Prettier, Husky + lint-staged                                    |
| CI/CD            | GitHub Actions, Vercel (preview deploy per PR, production from `main`)   |
| Security         | CodeQL, Dependabot, dependency review, secret scanning + push protection |
| Releases         | release-please (semantic versioning + generated changelog)               |
| Project tracking | GitHub Issues + Projects                                                 |

The table lists what is in place today. The planned stack (Supabase and more) and the reasons behind each choice are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

Requires Node.js 24 (see `.nvmrc`) and pnpm (pinned via the `packageManager` field — `corepack enable` sets it up).

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### AI, background jobs and tracing

- **AI Gateway key:** in the [Vercel dashboard](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys), create an AI Gateway API key and set `AI_GATEWAY_API_KEY` in `.env.local`. Development runs on the free monthly credit with free-tier models; don't buy credits, as that ends the free tier for the whole team. Unit tests and CI use mock models and need no key. Models are configured per task in `src/lib/ai/models.ts`.
- **Background jobs:** `pnpm dev` runs workflows locally with no setup (the local world stores runs in `.next/workflow-data`). Try the example with `curl -X POST --json '{"items":["one","two"]}' http://localhost:3000/api/workflows/example`, then inspect runs with `pnpm exec workflow web` or `pnpm exec workflow inspect runs`.
- **Tracing (optional):** create a project in [Langfuse EU cloud](https://cloud.langfuse.com) and set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to trace every AI call. Without keys, tracing is off.
- **Evals:** `pnpm evals` runs the eval datasets in `evals/` against real models (free tier). With Langfuse keys, results are recorded as dataset runs. Run them before changing a prompt or model; they never run in CI.

## Scripts

| Command              | Description                                   |
| -------------------- | --------------------------------------------- |
| `pnpm dev`           | Start the dev server                          |
| `pnpm build`         | Production build                              |
| `pnpm start`         | Serve the production build                    |
| `pnpm lint`          | ESLint (zero warnings allowed)                |
| `pnpm typecheck`     | Generate route types and run `tsc`            |
| `pnpm format`        | Format with Prettier                          |
| `pnpm test`          | Unit tests in watch mode                      |
| `pnpm test:coverage` | Unit tests with coverage report               |
| `pnpm test:e2e`      | Playwright E2E tests (run `pnpm build` first) |
| `pnpm check`         | Lint + typecheck + format check + unit tests  |
| `pnpm evals`         | AI evals against real models (not in CI)      |

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
src/app/         App Router routes, layouts and colocated unit tests
src/components/  Shared components; ui/ and ai-elements/ are generated by their CLIs
src/lib/         Utilities: env validation, Server Action input validation
src/lib/ai/      AI task and model configuration, test helpers
src/workflows/   Durable background workflows
evals/           AI eval datasets and runner (`pnpm evals`)
docs/            Architecture and technical decisions
e2e/             Playwright end-to-end tests
public/          Static assets
.github/         CI workflows, issue/PR templates, Dependabot
```

## License

Copyright © 2026 Florian Portscher. All rights reserved.

The source is public for review purposes; no license is granted for reuse or redistribution.
