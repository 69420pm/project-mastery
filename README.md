# Project Mastery

[![CI](https://github.com/69420pm/project-mastery/actions/workflows/ci.yml/badge.svg)](https://github.com/69420pm/project-mastery/actions/workflows/ci.yml)
[![CodeQL](https://github.com/69420pm/project-mastery/actions/workflows/codeql.yml/badge.svg)](https://github.com/69420pm/project-mastery/actions/workflows/codeql.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)

**An AI tutor for university exams, grounded in the student's own course.** Upload the slides, scripts and old exams, tell it about the exam, and it maps what the course teaches, plans what to study next and tutors you through it, asking more than it tells.

> _The AI handles everything about learning except the learning itself._

**[Try the live demo →](https://project-mastery-dun.vercel.app)**

![The knowledge map of a Linear Algebra course: nested Topics with their Knowledge components and Prerequisites](docs/screenshots/map.png)

## What it does

|                                                                                                                  |                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| ![The Brief: a conversation about the exam date, format and goal](docs/screenshots/brief.png)                    | ![A tutoring Chat that asks for the student's answer and cites the course page](docs/screenshots/chat.png)                  |
| **Brief.** The student tells the AI about the exam in a short conversation: date, format, goal and what to skip. | **Tutor.** The Chat teaches from the course, cites Material and page, and asks for the student's answer before it explains. |

1. **Upload.** Slides, scripts, exercise sheets and old exams are parsed into searchable chunks by a durable background workflow.
2. **Brief.** A conversation captures the exam. What else the student says is kept as notes the tutor reads in every Chat.
3. **Knowledge map.** The AI builds a graph of what the Materials teach: nested Topics, Knowledge components (KCs), the Prerequisites between them and the Exercises that test them.
4. **Plan.** Plain code, not a model, ranks what is worth doing next from the exam date, the goal, the student's recall and pace. A Today card shows it next to Progress and Readiness.
5. **Tutor.** One Study session at a time: the Chat answers from the course, checks the student's answers against answer keys with a math engine, and schedules reviews with the [FSRS](docs/adr/0027-per-day-scheduling-and-one-ranking.md) spaced-repetition algorithm.
6. **Practice.** Verified generated problems and mock exams, graded against the same answer keys.

[VISION.md](VISION.md) sets out the product and its principles: the student does the thinking, everything is grounded in the course, and the AI recommends while the student stays in control.

## Engineering highlights

- **Security in the database.** The app talks to Postgres as the signed-in student, and Row Level Security does the access control. Every table's policies are covered by pgTAP tests ([ADR 0003](docs/adr/0003-supabase-js-with-rls.md), [`supabase/tests/`](supabase/tests/)).
- **Architecture the build enforces.** Code is organized in feature modules whose layers depend in one direction only. Custom ESLint rules fail the build on a file in the wrong place or an import across a boundary, and the message says where the code belongs ([ADR 0014](docs/adr/0014-feature-modules-with-lint-boundaries.md), [`eslint/architecture.mjs`](eslint/architecture.mjs)).
- **Durable AI pipelines.** Parsing and the map build are Vercel Workflows that survive restarts and retry per step. Every model call is sized to fit a serverless function's time limit, and a weak build shows on the map instead of passing silently ([`build-knowledge-map.ts`](src/features/knowledge-map/workflows/build-knowledge-map.ts), [ADR 0009](docs/adr/0009-durable-background-jobs.md)).
- **Deterministic where it counts.** What to study next is a pure ranking function, not a prompt ([`ranking.ts`](src/features/study/domain/ranking.ts)), and answers are checked by a math engine that handles units, vectors, matrices and symbolic expressions ([`answer-keys.ts`](src/features/knowledge-map/domain/answer-keys.ts)). The model teaches; code decides and grades.
- **AI cost under control.** Every model call goes through one metered path with a per-student daily limit and is traced in Langfuse. Each upload is processed once and reused, and each task uses the smallest model that does it well ([ADR 0006](docs/adr/0006-ai-cost.md)).
- **Tests that need no API keys.** A deterministic mock AI provider lets unit tests, the Playwright suite and CI run the whole app offline. Live smoke checks against a real model run before each feature PR.
- **Decisions on record.** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) shows how the parts fit, and the [ADRs](docs/adr/) explain why each choice was made, including the ones later superseded.

| Area           | Choice                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| App            | Next.js (App Router, React Server Components, Server Actions), TypeScript, Zod |
| UI             | Tailwind CSS, shadcn/ui, AI Elements, KaTeX, React Flow with ELK, react-pdf    |
| Data           | Supabase: Postgres with pgvector, Auth, Storage, Row Level Security            |
| AI             | Vercel AI SDK through Vercel AI Gateway, Langfuse tracing, mathjs              |
| Background     | Vercel Workflow                                                                |
| Tests          | Vitest and React Testing Library, Playwright, pgTAP, Stryker                   |
| Quality and CI | ESLint, Prettier, Husky, GitHub Actions, CodeQL, Dependabot, release-please    |
| Hosting        | Vercel and Supabase, both in the EU                                            |

## How it was built: one developer, a team of agents

I make the product and architecture decisions; Claude Code agents write the code, in a workflow I designed. Almost every commit comes from the `agent69420pm` account, and every one reached `main` through a pull request I reviewed and merged.

1. **Decide.** `/grilling` interviews me about a plan until every decision is made, and `/to-spec` turns the answers into a one-page spec issue.
2. **Build.** `/build <spec>` implements the spec in its own git worktree: a fresh `builder` agent per slice, a `reviewer` pass against the spec and the repo's standards, a live smoke check against a real model, then a PR.
3. **Verify.** Agents check their own work. `pnpm -s agent` drives the running app in a real browser and database, hooks lint every edit, and an agent cannot stop until the full `pnpm check` passes.
4. **Clean up.** `/sweep` audits the codebase with parallel auditor agents and opens one issue of ranked changes; `/sweep-apply` builds the ones I tick, and `/retro` reviews what recent runs cost and where they went wrong.

The harness follows a few rules: fix a failure in the environment (a lint rule, a script, a hook) before adding a sentence to a prompt, keep always-loaded instructions short, and use the cheapest model that does a role well. They are written down in [docs/agents/harness.md](docs/agents/harness.md), with the skills and agents in [`.claude/`](.claude/), run reports in [docs/retros/](docs/retros/) and audits in [docs/sweeps/](docs/sweeps/).

## Run it locally

The live demo needs no setup. To run the app yourself or change it, see [CONTRIBUTING.md](CONTRIBUTING.md): local Supabase in Docker, AI keys, scripts and the agent CLI.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): you may read, run and modify the code for noncommercial use such as study, research and hobby projects. This is not an open source license. Third-party agent skills in `.claude/skills/` keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
