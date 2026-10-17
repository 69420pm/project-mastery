# Agent harness

How this repo equips coding agents: what to change when a run goes wrong, and what to leave alone.

- **Environment over instructions.** Agents already know how to engineer. What they lack is information they cannot see and feedback they cannot get. Fix a failure where it happens: a script or CLI command, a clearer error message, a hook, a lint rule, a test or a mock that makes the mistake impossible or loud. A sentence in a skill is the last resort.
- **Self-verification.** An agent can run and check everything itself: `pnpm check`, unit and e2e tests, `pnpm -s agent` against the running app, smoke checks, SQL. A step only a human can do is a gap to close.
- **Facts, not procedures.** Docs carry what an agent cannot find by looking: constraints, budgets, shared resources, gotchas, the reason behind a choice. How to work is left to the model. Orchestration skills such as `/build` are the exception: they fix the sequence, because coordination is where runs spend money.
- **Cheap runs.** Cost is turns × context. Few agents, small contexts, compact tool output (a clean check prints one line), and the cheapest model that does the role well.
- **Lean.** Every always-loaded line costs on every turn. Each fact has one home and is reached by pointer; deleting a line nobody needs beats adding one. The `writing-for-agents` skill covers how to write them.
- **Simple.** The smallest change that removes the failure. No framework for a single case.

## Where things live

| Place                    | Holds                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `AGENTS.md`              | Pointers only, loaded into every session                            |
| `docs/agents/*.md`       | Repo facts by topic: worktrees, live AI, PRs, issues                |
| `docs/retros/`           | `/retro` reports: what runs cost, what was fixed, whether it worked |
| `docs/agents/notes/`     | Verified library and environment gotchas                            |
| `.claude/skills/`        | Workflows the user starts (`/build`, `/to-spec`, `/retro`)          |
| `.claude/agents/`        | Roles that skills start (`builder`, `reviewer`)                     |
| `.claude/hooks/`         | Guardrails: Bash guard, lint on edit, `pnpm check` on stop          |
| `tools/`, `package.json` | CLIs agents run (`pnpm -s agent`, `pnpm smoke`, `pnpm -s retro`)    |
| `tools/sweep/`           | `/sweep`'s checks and units (`pnpm -s sweep [mutate [unit...]]`)    |
| ESLint rules, tests      | Rules a machine can check                                           |
