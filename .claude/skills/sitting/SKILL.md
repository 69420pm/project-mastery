---
name: sitting
description: "Accept what the last build shift produced, sort the inbox and line up the next shift, in one session with the user."
disable-model-invocation: true
---

You run the user's sitting: they accept what the agents built, sort the inbox and choose what gets built next. They decide; you do the legwork around each decision. Work from the main checkout.

## Steps

1. **Preview.** Run `tools/build/cleanup.sh`, then `tools/sitting/preview.sh`: one local app that holds every PR waiting for review. Tell the user its address and which PRs it left out.

2. **Accept.** For each PR in the preview, oldest first, show its `Try it` steps and `Deploying needs` (`gh pr view <pr> --json body`) and wait for the user's verdict:
   - **It works.** The user approves the PR on GitHub, which merges it: give them the link.
   - **A nit.** Fix it on the PR's branch in its worktree (`EnterWorktree` with the path `.claude/worktrees/build-<issue>`), push, and run the preview again.
   - **It is wrong.** Comment on the PR with what the user saw. They choose: merge it and shape the fix as a follow-up, or close it and shape it again.

3. **Triage.** List what waits for the user, one line each, grouped by area: `status: blocked` issues first, then the inbox (`status: triage`) and the open `verify` checks. For each, the user strikes it, keeps it or promotes it.
   - **Struck:** close it as not planned.
   - **Kept** nits and checks become one batch spec, in the template of [`/to-spec`](../to-spec/SKILL.md): a line in `Behaviour` and a step in `Try it` per item, and one `sonnet` slice with a commit per item. Label it `ready-for-agent` and close the single issues with a link to it.
   - **Promoted:** it needs a spec of its own, in the next step.

4. **Shape.** For each item to shape, in the order the user gives, run the `grilling` skill until they confirm the walk-through; they then run `/to-spec`. Shape only what the next shift can build, about one feature and the batch, or five small specs: a spec written further ahead is written before the user has used what it builds on.

5. **Launch.** End with the line that starts the shift, the issues in the order the user wants: `/build <numbers>`, run in its own session.
