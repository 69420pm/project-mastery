---
name: retro
description: "Review recent agent runs, write a report to docs/retros/, and apply the improvements the user picks. Run every few /build runs."
disable-model-invocation: true
model: opus
---

You review recent agent runs and improve the repo so later runs cost less and ship better code. [docs/agents/harness.md](../../../docs/agents/harness.md) says what a good fix looks like here.

## Steps

1. **Runs.** Review the runs the user names. Otherwise review the `/build` runs since the newest report in `docs/retros/`, or the last three if there is none. `pnpm -s retro` lists sessions with their cost.

2. **Last retro.** For each change the newest report applied, check whether these runs show it working and whether it caused new trouble.

3. **Evidence.** `pnpm -s retro <id>` digests one run: each agent with its start, duration, model and cost, plus prompts, handoffs, errors, and slow, large and repeated calls, each with its transcript line. Costs are API list prices, the measure every report compares; when the digest names a model it has no price for, add the price to `tools/retro/cli.ts`. Read the digests yourself. Raw transcripts run to megabytes, so hand questions that need them to an `Explore` agent with `model: "haiku"`: one agent per run, given the file, the lines and your questions, asked for a short answer. Also read each run's PR review comments, CI results and later fixes to the same code.

4. **Findings.** Look for **waste** (expensive agents, rework loops, oversized reads, slow or hung commands), **friction** (errors, guard refusals, hook blocks, facts an agent had to dig for or got wrong) and **escapes** (bugs that review, CI or the maintainer caught, or nobody did). Look as hard for **dead weight**: instructions the runs ignored without harm, or that the model followed by default. Done when every agent that cost more than a tenth of its run, every repeated error and every escape has a root cause you can point to.

5. **Report.** Write `docs/retros/<YYYY-MM-DD>.md`: each run as a table of its agents (start, duration, model, cost), how the last retro's changes did, then the findings ranked by money or quality at stake, each with its evidence (`session:line`), cause and proposed fix. For a fix, prefer an environment change (script, error message, hook, lint rule, test, mock), then a fact in `docs/agents/`, then a prompt change. A product bug becomes an issue. A one-off fluke is recorded, not fixed. Write only what the maintainer and the next retro need; the transcripts hold the rest.

6. **Pick.** Show the user the proposed fixes, one line each: the change, what it fixes, and how much it matters. Apply only the ones they pick.

7. **Apply.** Make the picked changes, run each new script, hook or check once, and mark in the report which fixes were applied. Open one PR, titled `chore(retro): …`, with the report and the changes.
