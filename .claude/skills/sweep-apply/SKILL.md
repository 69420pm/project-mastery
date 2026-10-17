---
name: sweep-apply
description: "Build the groups the user ticked in a /sweep decision issue as stacked PRs, one builder per group. Run it again after a lower PR merges, to rebase the stack. Run it in its own session."
model: haiku
disable-model-invocation: true
---

You apply a `/sweep` decision issue, given as `<issue>`: each ticked group becomes one PR, stacked on the PR of the group before it. The user is not watching: where something is open, decide and note it in the PR. `builder` agents write all code and tests; you start them, run git and GitHub following [docs/agents/pull-requests.md](../../../docs/agents/pull-requests.md), and write the sweep record. There is no reviewer: the tests, `pnpm check`, CI and a smoke check for a group with a model call verify each group. Every handoff stays in your context, so keep your own messages to a line or two.

## Steps

1. **Worktree.** `EnterWorktree` with the name `build-<issue>`. A new worktree gets `tools/build/setup.sh <issue> docs`, and its branch is the **base branch** of the stack. [docs/agents/worktrees.md](../../../docs/agents/worktrees.md) lists the commands the worktree accepts.

2. **Plan.** Read the issue with its comments. The ticked groups, in issue order, are your plan. List the stack's PRs with `gh pr list --state all --search "<issue> in:body" --json number,state,headRefName,baseRefName`, keeping those whose branch is `<type>/<issue>-<n>-…`. A group with a PR, or noted on the issue as stopped, is done.

3. **Rebase.** When a PR of the stack is merged and open PRs remain above it, `git fetch`, switch to the top open branch and run `git rebase --onto origin/main <highest merged branch> --update-refs`. A conflict goes to a `builder` with the conflicting files, to resolve and continue the rebase. Push every open branch with `git push --force-with-lease origin <branch>...`, and `gh pr edit <lowest open PR> --base main`.

4. **Record.** When no PR of the stack exists yet, write `docs/sweeps/<sweep date>.md` as [docs/agents/sweep.md](../../../docs/agents/sweep.md#record) describes, and commit it on the base branch as `docs: record the <sweep date> sweep`.

5. **Groups.** For each group left in the plan, in order:
   - **Branch** `<type>/<issue>-<n>-<kebab title>` from the top open branch of the stack, or from the base branch while there is none. The type is the group's.
   - **Build.** One `builder` in the foreground, without `isolation`. Its prompt: the issue number, the job `sweep group`, and the group's checkbox text verbatim. Check that the worktree is clean afterwards.
   - **PR.** Push, then `gh pr create --base <branch below, or main>` with the title `<type>: <group title>`. The body follows pull-requests.md and opens with `Group <n> of #<issue>`; the last group of this run adds `Closes #<issue>`.
   - **Stopped.** A builder that hands off `Stopped:` gets no PR. Comment on the issue with the group, the builder's reason, and the ticked groups that depend on it, directly or through another group; skip those too.

6. **CI.** Watch each new or pushed PR with `gh pr checks <pr> --watch`, run in the background. A red check goes to a `builder` on that branch with its failed log (`gh run view <run> --log-failed`). Push the fix, then rebase the branches above it with `git rebase <fixed branch> --update-refs` from the top branch, push them with `--force-with-lease`, and wait again.

7. **Report.** The PRs in stack order, the groups that stopped and why, and that the user merges from the bottom, running `/sweep-apply <issue>` after each merge. Leave the worktree on the top branch with a PR: once that PR is merged, `tools/build/cleanup.sh <issue>` from the main checkout removes the worktree.
