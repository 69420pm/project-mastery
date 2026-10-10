# Architecture

How Project Mastery is built and why. [VISION.md](../VISION.md) defines what the product is; this document defines the technical choices that serve it. Most of the stack below is planned and lands with the features that need it. The README lists what is in place today.

## Overview

```mermaid
flowchart LR
  student([Student]) --> app

  subgraph vercel [Vercel · fra1]
    app[Next.js app<br/>RSC + Server Actions]
    jobs[Durable workflows<br/>ingestion, planning]
  end

  subgraph supabase [Supabase · Frankfurt]
    auth[Auth]
    db[(Postgres<br/>+ pgvector)]
    storage[(Storage<br/>PDFs, page images)]
  end

  app --> auth
  app --> db
  app --> storage
  app --> jobs
  jobs --> db
  jobs --> storage
  app --> gateway[Vercel AI Gateway]
  jobs --> gateway
  gateway --> models[Model providers]
```

## Stack

| Area                     | Choice                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| Framework                | Next.js (App Router, React Server Components, Server Actions), TypeScript |
| Validation               | Zod (inputs, environment variables, structured AI output)                 |
| UI                       | Tailwind CSS, shadcn/ui, AI Elements, own design tokens                   |
| Math and documents       | KaTeX, Streamdown (streaming markdown with math), react-pdf               |
| Database, auth, storage  | Supabase: Postgres with pgvector, Auth, Storage, Row Level Security       |
| Data access              | supabase-js with generated types, SQL migrations through the Supabase CLI |
| AI                       | Vercel AI SDK through Vercel AI Gateway                                   |
| Background jobs          | Durable workflows: Vercel Workflow, to be confirmed against Inngest       |
| Spaced repetition        | FSRS (`ts-fsrs`)                                                          |
| LLM tracing and evals    | Langfuse                                                                  |
| Errors, analytics, email | Sentry, PostHog, Resend                                                   |
| Hosting                  | Vercel (functions in `fra1`), Supabase (Frankfurt)                        |

## Environments

| Environment | App                         | Supabase               | AI                                |
| ----------- | --------------------------- | ---------------------- | --------------------------------- |
| Local       | `pnpm dev`                  | Supabase CLI in Docker | Gemini API free tier, or Gateway  |
| Tests / CI  | Vitest, Playwright          | Supabase CLI in Docker | AI SDK mock models, no real calls |
| Preview     | Vercel preview per PR       | Staging project        | AI Gateway, card on file          |
| Production  | Vercel production on `main` | Production project     | AI Gateway, purchased credits     |

Preview deployments never touch production data.

## Project structure

The code is organized by feature, in layers that depend in one direction only ([ADR 0014](adr/0014-feature-modules-with-lint-boundaries.md)). ESLint enforces everything in this section: a file in the wrong place or an import across a forbidden boundary fails `pnpm lint`, with a message that says where the code belongs.

```
src/
├── app/                   Routing only: Next.js special files
│   ├── (marketing)/       Public pages
│   ├── (auth)/            Sign-in pages and the email link route
│   └── api/               Route handlers that need raw HTTP (streaming, webhooks)
├── features/<feature>/    One folder per product capability
├── components/            Shared UI without domain knowledge
│   ├── ui/                shadcn/ui, generated
│   └── ai-elements/       AI Elements, generated
├── hooks/                 Shared client hooks (use-*.ts)
├── lib/                   Platform: Supabase clients, auth session, AI, tracing, env
├── proxy.ts               Session refresh on every request
└── instrumentation.ts     Tracing setup
```

### Layers

```
app ──► features ──► components ──► hooks ──► lib
           │ ▲
           └─┘  other features only through index.ts / server.ts
```

- **`app/`** contains only Next.js files: `page`, `layout`, `loading`, `error`, `not-found`, `route` and metadata files. Pages fetch data through feature server code and compose feature components. Route handlers delegate to a feature in one line. Signed-in pages go in the `(app)` route group, and each page calls `requireUser` with its own path; its layouts only read the user for the shell (`components/app-shell.tsx`), since layouts do not re-render on navigation.
- **`features/<feature>/`** holds everything one product capability needs. A feature imports another feature only through that feature's public entry files, and import cycles are errors. For example, `chat` depends on `courses`: a Chat belongs to a Course and attaches its Materials. `courses` never imports `chat`.
- **`components/`, `hooks/`, `lib/`** are shared and know nothing about features or routes, so they never import from `features/` or `app/`.
- Root files (`proxy.ts`, `instrumentation.ts`) and `evals/` use `lib/` and features' `server.ts`.
- `tools/agent/` is development tooling outside the app ([ADR 0015](adr/0015-agent-cli-for-running-app.md)). It drives the running app through HTTP, a browser and SQL, and imports nothing from `src/`.
- `tools/spec-run/` holds the shell scripts that `/implement-spec` runs: preparing an agent worktree for a ticket, printing a ticket's brief, merging a finished ticket into the integration branch behind the full checks, and cleaning up the worktrees afterwards.

### Anatomy of a feature

```
features/<feature>/
├── index.ts         Public API, safe for any code: components, Server Actions, schemas, types
├── server.ts        Public API for server code only: queries, services, route handlers
├── components/      React components (Server Components by default)
├── hooks/           Client hooks (use-*.ts)
├── server/          Server-only code, every module imports "server-only"
│   ├── actions.ts   Server Actions ("use server"), the only place they may live
│   └── *.ts         Queries (the Data Access Layer), services, route handler logic
├── ai/              Prompts, tools and agents, calling models through aiTask (ADR 0005)
├── workflows/       Durable workflows and their steps (ADR 0009)
├── domain/          Pure logic without I/O, such as scheduling or scoring
├── schemas.ts       Zod schemas shared by forms and Server Actions
└── types.ts         Shared types
```

Only the folders a feature needs exist. Inside a feature, files import each other freely; imports from other folders use the `@/` alias, never `../`. Entry files list their exports by name (no `export *`), so the public API stays deliberate. Unit tests sit next to the file they test as `*.test.ts(x)`.

### How data moves

- **Reads:** a page (Server Component) calls a query in the feature's `server/`. The query checks the user (`requireUser`), reads with the Supabase server client, so Row Level Security applies, and returns only the fields the UI needs.
- **Writes:** a form calls a Server Action in `server/actions.ts`, which validates the input with Zod, checks the user, writes, revalidates and returns an `ActionResult`.
- **AI streaming:** `useChat` posts to a route handler in `app/api/`, which delegates to a handler exported from the feature's `server.ts`, which calls models through `aiTask`.
- **File uploads:** Materials live in the private Storage bucket `course-files`, at `<owner id>/<course id>/<material id>`. The browser uploads the file straight to Storage, which its policies allow only under the Student's own id, then calls the `registerMaterial` Server Action in the `courses` feature, which checks the upload and stores the Material row. Files never pass through a server function, so their size is not bound by its request limit.
- **Background jobs:** server code starts a workflow from the feature's `workflows/`. Steps that run without a user use the admin client and report progress to the database, where the UI reads it.

### What the lint rules enforce

| Rule                                 | Enforces                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `project/file-structure`             | Every source file matches the structure above                                               |
| `boundaries/dependencies`            | Layer directions, feature public APIs, and where restricted modules may be used (below)     |
| `import-x/no-cycle`                  | No import cycles, including between features                                                |
| `project/require-server-only`        | Feature server modules import `server-only`                                                 |
| `project/use-server-location`        | `"use server"` only in `server/actions.ts`, no inline Server Actions                        |
| `project/no-server-import-in-client` | Client Components do not import server modules (Server Actions excepted)                    |
| `project/server-action-auth`         | Every Server Action's first `await` is `getUser()` or `requireUser()` (auth forms excepted) |
| `project/server-action-validation`   | A Server Action that takes input calls `parseActionInput`                                   |
| `max-lines`                          | At most 500 lines of code per file (generated code excepted): split by behaviour            |
| `check-file/*`                       | Kebab-case file and folder names (route folders may use Next.js conventions)                |
| `no-restricted-imports`              | `@/` alias instead of `../` paths                                                           |
| `no-restricted-properties`           | `process.env` only in env modules (`env.ts`, `*-env.ts`)                                    |

Restricted modules: `@supabase/*` only in `lib/supabase/` (type imports are allowed anywhere); the admin client only in `workflows/`; Supabase clients never directly in `app/`; `workflow` only in features' `workflows/` and `server/`; AI provider packages only in `lib/ai/`; Langfuse and OpenTelemetry only in `lib/tracing/` and `evals/`.

The configuration lives in `eslint/architecture.mjs`, with project-specific rules in `eslint/plugin/`. `eslint/architecture.test.mjs` lints sample files against the real configuration to show each rule fires where it should and stays quiet where it should not. Changing the structure means changing the configuration, its tests and this section in the same PR.

### Adding a feature

1. Create `src/features/<feature>/` with the folders it needs, following the anatomy above.
2. Export what pages and other features use from `index.ts` (anything client-safe) or `server.ts` (anything server-only).
3. Add the routes in `src/app/` as thin files that import only from those entry files.

## Decisions

Each technical decision is an ADR in [adr/](adr/), with its context, the choice and its consequences. A decision changes through a PR that updates its ADR, or adds a new ADR that supersedes it.

- [0001](adr/0001-hosted-only.md): Hosted only, no self-hosted version
- [0002](adr/0002-supabase-backend.md): Supabase as the backend platform
- [0003](adr/0003-supabase-js-with-rls.md): supabase-js with Row Level Security instead of an ORM
- [0004](adr/0004-eu-region.md): EU region
- [0005](adr/0005-ai-sdk-through-gateway.md): Vercel AI SDK through Vercel AI Gateway
- [0006](adr/0006-ai-cost.md): AI cost: near zero in development, metered in production
- [0007](adr/0007-ingest-each-upload-once.md): Ingestion: process every upload once
- [0008](adr/0008-workflows-by-default.md): Workflows by default, agents where they pay off
- [0009](adr/0009-durable-background-jobs.md): Durable background jobs
- [0010](adr/0010-fsrs-for-spaced-repetition.md): Learning science as libraries, not inventions
- [0011](adr/0011-shadcn-ui-with-own-design.md): UI built on shadcn/ui with its own design
- [0012](adr/0012-ai-observability-and-evals.md): Observability and quality of AI behavior
- [0013](adr/0013-hosting-plans.md): Hosting plans
- [0014](adr/0014-feature-modules-with-lint-boundaries.md): Feature modules with lint-enforced boundaries
- [0015](adr/0015-agent-cli-for-running-app.md): Agents verify changes in the running app through one CLI

## Open questions

- Durable workflow engine: Vercel Workflow (set up) or Inngest ([ADR 0009](adr/0009-durable-background-jobs.md)).
- Models for ingestion, the Chat and embeddings, chosen by testing on real course materials.
- Design direction: typography, color and motion.
