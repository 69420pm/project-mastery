---
name: sitting
description: "Go through what waits for the user (PRs, the inbox) and line up the next build shift, in one session with the user."
disable-model-invocation: true
---

You run the user's sitting: they decide what happens to the waiting PRs, sort the inbox and choose what gets built next. They decide; you do the legwork around each decision. Code changes belong to the shift: whatever a PR or an issue needs built goes into its queue, where a `builder` makes it. Work from the main checkout. When the user names a focus with the command (only the PRs, only the inbox), run those steps.

## Steps

1. **Waiting PRs.** Run `tools/build/cleanup.sh`, then `tools/sitting/waiting.sh`, and show what it found in a line or two per PR: which ones only wait for the user's approval, and what stands in the way of the others (their open comments, a failed check, a conflict with `main`). The user tries a PR on its preview or reads it, and approves it on GitHub, which merges it. They do that on their own, before or after the sitting, and write what they want changed as a comment on the PR.
   - **Something stands in its way:** propose queueing the PR for the shift. On a yes, label it `ready-for-agent`.
   - **The user says it here:** post their words on the PR, starting with `**Maintainer, in /sitting:**` (`gh pr comment`), so the shift finds them, and queue the PR.
   - **A comment asks for more than the PR set out to do:** the user chooses: merge it and shape the rest in step 3, or close it and shape it again.

2. **Triage.** List what waits for the user, one line each, grouped by area: `status: blocked` issues first, then the inbox (`status: triage`) and the open `verify` checks. For each, the user strikes it, keeps it or promotes it.
   - **Struck:** close it as not planned.
   - **Kept** nits and checks become one batch spec, in the template of [`/to-spec`](../to-spec/SKILL.md): a line in `Behaviour` and a step in `Try it` per item, and one `sonnet` slice with a commit per item. Label it `ready-for-agent` and close the single issues with a link to it.
   - **Promoted:** it needs a spec of its own, in the next step.
   - **A spec in the inbox** was written by a build, without the user: show its top half. Approved, it swaps `status: triage` for `ready-for-agent`.

3. **Shape.** For each item to shape, in the order the user gives, run the `grilling` skill until they confirm the walk-through; they then run `/to-spec`. Before grilling a feature or a bet, suggest switching to Opus (`/model opus`): a wrong spec costs a shift. Shape only what the next shift can build, about one feature and the batch, or five small specs: a spec written further ahead is written before the user has used what it builds on.

4. **Launch.** End with the line that starts the shift in its own session: `pnpm shift <numbers>`. Put the queued PRs first, then the issues in the order the user wants, and last any spec whose build runs live rounds: it can use up the usage window, and everything behind it waits.
