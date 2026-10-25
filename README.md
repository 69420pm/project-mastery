# Project Mastery

[![CI](https://github.com/69420pm/project-mastery/actions/workflows/ci.yml/badge.svg)](https://github.com/69420pm/project-mastery/actions/workflows/ci.yml)
[![CodeQL](https://github.com/69420pm/project-mastery/actions/workflows/codeql.yml/badge.svg)](https://github.com/69420pm/project-mastery/actions/workflows/codeql.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)

> **The AI handles everything about learning except the learning itself.**

Project Mastery is an AI tutor that helps university students master their course material and prepare for exams. A student uploads slides, scripts and old exams, tells the AI about the exam, and gets a study plan and a tutor grounded in their own course: it asks more than it tells, cites the page it draws on and schedules reviews so the knowledge stays.

**Live demo:** https://project-mastery-dun.vercel.app. Create an account to try it; AI use is capped per day.

[VISION.md](VISION.md) defines the product and its principles, and [GLOSSARY.md](GLOSSARY.md) the words used for its concepts in code, issues and UI.

## What it does today

1. **Upload:** Materials (slides, scripts, exercise sheets, old exams) are parsed into searchable chunks by a durable background workflow.
2. **Brief:** the student tells the AI about the exam in a conversation: its date, format, their goal, weekly hours and what to skip.
3. **Knowledge map:** the AI builds a map of what the Materials teach, with Big ideas, Topics, Knowledge components, Prerequisites and the Exercises that test them, drawn as a graph.
4. **Plan:** code, not a model, plans over the Topics from the exam date, the weekly hours and the student's measured pace, and shows a Today card.
5. **Tutor:** a Chat answers from the course, cites Material and page, asks the student to produce answers before it gives solutions, remembers the student, and schedules reviews with [FSRS](docs/adr/0019-fsrs-replay.md) replayed from the student's attempts.
6. **Read:** every Topic has Reading sections with a source pane that shows the original page.

Still to come ([epic #170](https://github.com/69420pm/project-mastery/issues/170)): Learn sessions, a problem pool with verified generated problems, review and practice sessions, mock exams with a readiness estimate, and an evaluation of the whole tutor with simulated students.

## How it is built

- **Feature modules with enforced boundaries.** Code is organized by feature in layers that depend in one direction only. ESLint rules fail the build on a file in the wrong place or an import across a boundary, and the message says where the code belongs ([ADR 0014](docs/adr/0014-feature-modules-with-lint-boundaries.md)).
- **Security in the database.** The app talks to Postgres through supabase-js as the signed-in student, and Row Level Security does the access control. Every table has pgTAP tests for its policies ([ADR 0003](docs/adr/0003-supabase-js-with-rls.md)).
- **Durable workflows.** Parsing, map building and other long jobs run as Vercel Workflows that survive restarts and retry per step ([ADR 0008](docs/adr/0008-workflows-by-default.md), [ADR 0009](docs/adr/0009-durable-background-jobs.md)).
- **AI that is measured.** Every model call goes through one metered path with a per-student daily limit, and is traced in Langfuse. Prompts and models are checked by evals with LLM judges whose agreement with human labels is calibrated ([ADR 0006](docs/adr/0006-ai-cost.md), [ADR 0012](docs/adr/0012-ai-observability-and-evals.md)).
- **Tests that need no keys.** A deterministic mock AI provider lets unit tests, the Playwright suite and CI run the full app without a model or a network. Mutation testing with Stryker checks that the tests would notice a broken line.
- **Decisions on record.** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) shows the stack and how the parts fit, and 20 [ADRs](docs/adr/) explain why each choice was made.

| Area           | Choice                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| App            | Next.js (App Router, React Server Components, Server Actions), TypeScript, Zod |
| UI             | Tailwind CSS, shadcn/ui, AI Elements, KaTeX, React Flow with ELK, react-pdf    |
| Data           | Supabase: Postgres with pgvector, Auth, Storage, Row Level Security            |
| AI             | Vercel AI SDK through Vercel AI Gateway, Langfuse tracing and evals            |
| Background     | Vercel Workflow                                                                |
| Tests          | Vitest and React Testing Library, Playwright, pgTAP, Stryker                   |
| Quality and CI | ESLint, Prettier, Husky, GitHub Actions, CodeQL, Dependabot, release-please    |
| Hosting        | Vercel and Supabase, both in the EU                                            |

## How it was built

Almost every commit here comes from the `agent69420pm` account: the code is written by Claude Code agents, in a workflow I set up and review myself. I make the product decisions and read every PR before I squash-merge it.

1. **Decide:** `/grilling` interviews me about a plan until the decisions are made, and `/to-spec` turns them into a one-page spec issue.
2. **Build:** `/build <spec>` implements one spec in its own git worktree: a fresh `builder` agent per slice, then one `reviewer` pass against the spec and the repo's standards, a live smoke check against a real model and a PR, with no questions in between.
3. **Verify:** agents check their own work. `pnpm -s agent` drives the running app in a real browser and database, and hooks run lint on every edit and the full `pnpm check` before an agent may stop.
4. **Clean up:** `/sweep` audits the whole codebase with auditor agents and opens one decision issue of ranked changes, `/sweep-apply` builds the ones I tick, and `/retro` reviews what recent runs cost and what went wrong.

The harness follows a few rules: fix a failure in the environment (a lint rule, a script, a hook) before adding a sentence to a prompt; keep always-loaded instructions short; use the cheapest model that does a role well. They are written down in [docs/agents/harness.md](docs/agents/harness.md), with the skills and agents in [`.claude/`](.claude/), the run reports in [docs/retros/](docs/retros/) and the audits in [docs/sweeps/](docs/sweeps/).

## Run it locally

The live demo needs no setup. To run the app yourself or to change it, follow [CONTRIBUTING.md](CONTRIBUTING.md): local Supabase in Docker, AI keys, scripts, the agent CLI and the workflow for PRs.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): you may read, run and modify the code for private and other noncommercial use, such as study, research and hobby projects. You may not sell it or use it commercially. This is not an open source license.

Third-party agent skills in `.claude/skills/` keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
