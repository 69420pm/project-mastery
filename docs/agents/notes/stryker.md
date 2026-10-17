# Stryker

- Stryker 10's Vitest runner (`@stryker-mutator/vitest-runner`) never activates mutants under Vitest 5: every mutant survives, also with `related: false`. Verified 2026-10-17.
- The `command` test runner, built into `@stryker-mutator/core`, works: `stryker.config.mjs` runs `pnpm exec vitest run <unit paths>` for each mutant. It has no per-test coverage, so each mutant runs the unit's whole suite. 96% on `study/domain/ladder.ts` and `reviews.ts`, 108 mutants in 2 min at concurrency 4; the `usage` unit, 77 mutants, in about 20 s at concurrency 9.
- Without `ignorePatterns`, Stryker copies the whole checkout into each sandbox, `.next/` and `.claude/worktrees/` included. The config copies only what Vitest needs.
- Knip's Stryker plugin reports `@stryker-mutator/command-runner` as unlisted; it is part of the core package, so `knip.jsonc` ignores it.
