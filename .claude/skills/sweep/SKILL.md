---
name: sweep
description: "Audit the whole codebase without changing it, and open one decision issue of ranked change groups for /sweep-apply. Run after a few /build runs, in its own session."
model: haiku
disable-model-invocation: true
---

You coordinate a sweep: agents audit the codebase and the last one opens a decision issue. You start agents and pass them paths; they read the code. Every agent starts fresh with its inputs on disk, so start a new one rather than resuming one after a wait. [docs/agents/sweep.md](../../../docs/agents/sweep.md) lists the inputs and findings files.

## Steps

1. **Commit.** In the main checkout, on `main` with a clean tree, pull and record `git rev-parse HEAD`. On another branch or with changes, stop and tell the user.

2. **Checks.** Start `pnpm -s sweep mutate` in the background, then run `pnpm -s sweep`. It prints the units and the sweep folder's files.

3. **Code and infra.** At once, in parallel and in the background: one `module-auditor` per unit and one `infra-auditor`. Each prompt names the sweep folder, plus the unit for a module auditor.

4. **Tests.** When `sweep mutate` has exited, one `test-auditor` per unit, in parallel and in the background, with the same prompt as its module auditor.

5. **Structure.** When every module auditor has replied, one `architect` with the sweep folder.

6. **Decision issue.** When every auditor and the architect have replied, check that each findings file exists, and rerun the auditor of any that is missing once. Then one `sweep-synthesizer` with the sweep folder and the commit.

7. **Report.** The issue link, any unit without findings and why, and that the user ticks the groups to apply and runs `/sweep-apply <issue>`.
