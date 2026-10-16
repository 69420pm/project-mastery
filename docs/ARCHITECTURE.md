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
    storage[(Storage<br/>PDFs, images)]
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
| Graphs                   | React Flow (`@xyflow/react`) laid out by ELK (`elkjs`) in a web worker    |
| Database, auth, storage  | Supabase: Postgres with pgvector, Auth, Storage, Row Level Security       |
| Data access              | supabase-js with generated types, SQL migrations through the Supabase CLI |
| AI                       | Vercel AI SDK through Vercel AI Gateway                                   |
| Background jobs          | Durable workflows: Vercel Workflow                                        |
| PDF pages to images      | unpdf with @napi-rs/canvas                                                |
| Spaced repetition        | Own review ladder replayed from the attempts log; FSRS (`ts-fsrs`) later  |
| LLM tracing and evals    | Langfuse                                                                  |
| Errors, analytics, email | Sentry, PostHog, Resend                                                   |
| Hosting                  | Vercel (functions in `fra1`), Supabase (Frankfurt)                        |

## Environments

| Environment | App                         | Supabase               | AI                                                       |
| ----------- | --------------------------- | ---------------------- | -------------------------------------------------------- |
| Local       | `pnpm dev`                  | Supabase CLI in Docker | Gemini API free tier for text, AI Gateway for embeddings |
| Tests / CI  | Vitest, Playwright          | Supabase CLI in Docker | AI SDK mock models, no real calls                        |
| Preview     | Vercel preview per PR       | Staging project        | AI Gateway, card on file                                 |
| Production  | Vercel production on `main` | Production project     | AI Gateway, purchased credits                            |

Preview deployments never touch production data.

## Project structure

The code is organized by feature, in layers that depend in one direction only ([ADR 0014](adr/0014-feature-modules-with-lint-boundaries.md)). ESLint enforces everything in this section: a file in the wrong place or an import across a forbidden boundary fails `pnpm lint`, with a message that says where the code belongs.

```
src/
├── app/                   Routing only: Next.js special files
│   ├── (marketing)/       Public pages
│   ├── (auth)/            Sign-in pages and the email link route
│   ├── (app)/             Signed-in pages
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
- **`features/<feature>/`** holds everything one product capability needs. A feature imports another feature only through that feature's public entry files, and import cycles are errors. For example, `chat` depends on `courses`: a Chat belongs to a Course and attaches its Materials. `courses` never imports `chat`. Likewise `courses` depends on `ingestion`, which parses its Materials, and `ingestion` never imports `courses`.
- **`components/`, `hooks/`, `lib/`** are shared and know nothing about features or routes, so they never import from `features/` or `app/`.
- Root files (`proxy.ts`, `instrumentation.ts`) and `evals/` use `lib/` and features' `server.ts`. Smoke checks in `evals/smoke/` (`pnpm smoke`, [docs/agents/live-ai.md](agents/live-ai.md)) may also use the admin client, to set up and remove a throwaway Student on the local stack.
- `tools/agent/` is development tooling outside the app ([ADR 0015](adr/0015-agent-cli-for-running-app.md)). It drives the running app through HTTP, a browser and SQL, and imports nothing from `src/`. `tools/retro/` digests Claude Code transcripts for `/retro` (`pnpm -s retro`).

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
- **Knowledge map:** the `knowledge-map` feature builds a Course's map from the chunks of its parsed Materials, which it reads through `ingestion`'s `server.ts`. The `startKnowledgeMapBuild` Server Action (Build, then Update map) queues the build through `queue_knowledge_map_build`, a conditional upsert, and starts the `buildKnowledgeMap` workflow, which updates the stored map; a first build updates an empty one. It maps only the chunks not yet in `knowledge_map_chunks`, one step per model call (task `map`, and task `exercise` once per new exercise subtask with its pair from `exercise_solutions`), and drops what deleted chunks taught. `apply_knowledge_map_update` stores the result in one transaction: rows of the stored map keep their ids, so KCs, Exercises and Findings keep their identity, and the new chunks are recorded as processed. The map page polls while the build is `building`; it no longer lists Findings, which the Brief page shows. It draws the map as a graph ([ADR 0017](adr/0017-react-flow-and-elk-for-the-knowledge-map-graph.md)): `knowledge-map/domain` turns the map into nodes and edges, ELK lays them out in a web worker only when they change, and clicking a KC opens a panel with every stat about it, including what `study`'s `getKcLearning` and `priorities`' `getPriorities` give, which the page passes in.
- **Brief:** the `brief` feature stores what a Student told the AI about a Course's exam, reading the Course's Materials from `courses` and enforcing the Daily limit through `usage`. Its page creates the Brief and a static opening message on first open; `useChat` posts to `/api/brief`, whose handler streams task `brief` with three tools, `saveBrief`, `addNote` and `answerFinding`. The first two write as the Student through the `save_brief` and `add_brief_note` database functions, each one transaction, so a failed call changes nothing and concurrent calls of one reply keep each other's writes. Once intake is done, the Brief asks the Course's open Findings one at a time, which it reads and answers through `knowledge-map`'s `server.ts`: opening the page posts the next one as a static message when none is asked, and `answerFinding` stores the answer and marks the next one asked. Beside the conversation (in a Sheet below `lg`), `BriefPanel` shows the exam facts, excluded Materials and notes from `getBrief`, every Finding from `knowledge-map`'s `getFindings`, and the study plan and Memory card, which the page passes in because `study` depends on `brief`. After each finished reply the page calls `router.refresh()`, and the conversation appends any static message the refresh posted.
- **Priorities:** the `priorities` feature gives each KC of a Course a Priority for the Student's exam, reading the stored map through `knowledge-map`'s `server.ts` and the Brief's excluded Materials through `brief`'s. App pages show the Priorities, and `study` ranks the Chat's candidates by them. Opening the map page calls `ensurePriorities`, which queues a run through `queue_priority_run`, a conditional upsert that succeeds only for a built map with no run running and a change (the map's `finished_at`, the Brief's `updated_at` or a Finding's `answered_at`) newer than the last run's `computed_at`, and starts the `updatePriorities` workflow. Code computes each KC's base from exam points, Exercises and dependents, times a multiplier: 0 for KCs taught only by excluded Materials, times the model's adjustment (task `priority`, one call from the Brief's notes and the answered Findings, made only when they or the map changed after the run's `adjusted_at` and otherwise reused from `priority_runs.adjustments`), and `replace_kc_priorities` replaces the Course's `kc_priorities` in one transaction. The page passes the priorities into the map component, so `knowledge-map` never imports `priorities`, and polls while the run is `running`.
- **Tutoring:** every Chat is a tutoring session. The `study` feature holds what the AI needs to tutor, and `chat` imports its `server.ts`. On every reply, `startTutoring` reads, as the Student, the stored map through `knowledge-map`'s `server.ts`, the Priorities through `priorities`', the exam date, weekly hours and goal through `brief`'s, the Course's attempts and its Memory, and builds the tutor context: today, the exam date, the study plan (the Phase, the share of the KCs that matter that fit the weekly hours, the left-out count and the goal, derived by code with the map page's plan line; the instructions add guidance per Phase), up to 8 due reviews ranked by Priority × (days overdue + 1) with a count of the rest, and up to 10 candidate KCs (new, Priority above 0, each Prerequisite prior knowledge or taught), ranked by Priority and grouped by big idea, each with its anchors. The context goes into the Chat's instructions, written by code like the Brief's, with the Memory in full when it isn't empty. The reply streams task `chat` with at most 5 steps and four tools. `readKcs` reads KCs with up to 3 source chunks each through `ingestion`'s `server.ts`, each linked to the chunk on its Material's page. `findExercises` returns up to 3 Exercises that test given KCs and that the Student has no attempt on, old-exam ones first, each with its question, a page link and its paired solution (from `exercise_solutions`, labelled with its status), read the same way. `recordAttempt` stores, as the Student in one insert, one `attempts` row per KC a problem or review question tested (correct or not, and how much the AI helped), and returns each KC's new level and next review. `remember` appends one dated line to the Course's Memory (`memories`, one text of at most 4,000 characters per Course) with `append_memory`, as the Student; the Student edits the whole text on the Brief page, and the Brief's own AI doesn't read it. The attempts log is the only stored learner state ([ADR 0010](adr/0010-fsrs-for-spaced-repetition.md)): on every read, code replays a KC's attempts into its place on the review ladder, and `getKcStates` gives each KC's state (new, learning, due or mastered). Tool calls are stored with the reply, and the Chat shows each as a collapsed step card in reply order, its one-line summary written by code in `chat/domain`; a call that never returned shows as stopped once the reply is done. Each AI reply also stores the tutor context it was given (`chat_messages.tutor_context`, sent as message metadata on the `start` part), which the reply's Context sheet shows with the instructions re-rendered by today's code. The stored context has `study`'s `TutorContext` shape and is checked only as an object, so a change to that type must keep older rows readable. The reply's usage is sent on the `finish` part and its `ai_usage` row carries the reply's id (`reply_id`, no foreign key, since usage is recorded before the reply is saved), so a reopened Chat shows each reply's model, tokens and cost. Topics are not stored apart from that snapshot.
- **Parsing:** the `ingestion` feature parses every Material once, as [ADR 0007](adr/0007-ingest-each-upload-once.md) describes. `registerMaterial` in `courses` starts its workflow; the Material moves from `queued` through `parsing` to `parsed` or `failed`, and the Materials page polls while any Material is waiting or parsing. Parse and Retry share the `startMaterialParse` Server Action, which queues the Material through the `queue_material_parse` database function, a conditional update, so two presses start one workflow. A chunk's figure is a description in words, shown as text in the chunk view; the chunk view also lists the Findings about each chunk, which the materials page reads from `knowledge-map` and passes in.

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

Restricted modules: `@supabase/*` only in `lib/supabase/` (type imports are allowed anywhere); the admin client only in `workflows/` and `evals/smoke/`; Supabase clients never directly in `app/`; `workflow` only in features' `workflows/` and `server/`; AI provider packages only in `lib/ai/`; Langfuse and OpenTelemetry only in `lib/tracing/` and `evals/`.

The configuration lives in `eslint/architecture.mjs`, with project-specific rules in `eslint/plugin/`. `eslint/architecture.test.mjs` lints sample files against the real configuration to show each rule fires where it should and stays quiet where it should not. Changing the structure means changing the configuration, its tests and this section in the same PR.

### Adding a feature

1. Create `src/features/<feature>/` with the folders it needs, following the anatomy above.
2. Export what pages and other features use from `index.ts` (anything client-safe) or `server.ts` (anything server-only). A constant or schema that server code needs may be re-exported from `server.ts` too, with a comment saying why: `index.ts` loads React components, which fail to import outside Next.js (evals, scripts). `evals/next-aliases.ts` aliases `@/features/courses` to its `server.ts` for the same reason, so chat code must not import a `courses` component or Server Action.
3. Add the routes in `src/app/` as thin files that import only from those entry files.

## Decisions

Each technical decision is an ADR in [adr/](adr/), with its context, the choice and its consequences. A decision changes through a PR that updates its ADR, or adds a new ADR that supersedes it.

- [0001](adr/0001-hosted-only.md): Hosted only, no self-hosted version
- [0002](adr/0002-supabase-backend.md): Supabase as the backend platform
- [0003](adr/0003-supabase-js-with-rls.md): supabase-js with Row Level Security instead of an ORM
- [0004](adr/0004-eu-region.md): EU region
- [0005](adr/0005-ai-sdk-through-gateway.md): Vercel AI SDK through Vercel AI Gateway
- [0006](adr/0006-ai-cost.md): AI cost: the Gateway's free credit in development, metered in production
- [0007](adr/0007-ingest-each-upload-once.md): Ingestion: process every upload once
- [0008](adr/0008-workflows-by-default.md): Workflows by default, agents where they pay off
- [0009](adr/0009-durable-background-jobs.md): Durable background jobs
- [0010](adr/0010-fsrs-for-spaced-repetition.md): Spaced repetition: a review ladder now, FSRS later
- [0011](adr/0011-shadcn-ui-with-own-design.md): UI built on shadcn/ui with its own design
- [0012](adr/0012-ai-observability-and-evals.md): Observability and quality of AI behavior
- [0013](adr/0013-hosting-plans.md): Hosting plans
- [0014](adr/0014-feature-modules-with-lint-boundaries.md): Feature modules with lint-enforced boundaries
- [0015](adr/0015-agent-cli-for-running-app.md): Agents verify changes in the running app through one CLI
- [0016](adr/0016-gemini-api-for-local-development.md): Local development on the Gemini API free tier
- [0017](adr/0017-react-flow-and-elk-for-the-knowledge-map-graph.md): React Flow and ELK for the Knowledge map graph

## Open questions

- Models for ingestion, the Chat and embeddings, chosen by testing on real course materials.
- Design direction: typography, color and motion.
