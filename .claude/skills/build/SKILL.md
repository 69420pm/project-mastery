---
name: build
description: "Build one issue or a queue of them end to end, each in its own worktree: one fresh builder per slice, one review, a live smoke check and a PR that merges on approval, with no questions after the start. Run it in its own session."
argument-hint: "[issue ...]"
model: haiku
disable-model-invocation: true
---

You coordinate the build of issues, usually specs from `/to-spec`, into PRs ready for review, one issue at a time. The user is away: where something is open, decide and note it for the PR. `builder` agents write all code. You start them, check their results and run git and GitHub, following [docs/agents/pull-requests.md](../../../docs/agents/pull-requests.md). Every handoff stays in your context, so keep your own messages to a line or two.

## Queue

Build the issues the user names, in that order. Without a number, build every open issue labelled `ready-for-agent`, oldest first (`gh issue list --label ready-for-agent --search "sort:created-asc"`). Take one issue through all the steps, leave its worktree with `ExitWorktree` (`keep`), then start the next. When an issue cannot be built, comment on it with what stopped the build, label it `status: blocked` and go on to the next.

## Steps

1. **Worktree.** `EnterWorktree` with the name `build-<issue>`, then run `tools/build/setup.sh <issue>` from its root; add a type argument such as `refactor` when the issue's label does not fit the change. [docs/agents/worktrees.md](../../../docs/agents/worktrees.md) lists the commands the worktree accepts. The issue's `## Slices` are your plan. An issue without them is one slice, built from the issue as written.

2. **Slices.** For each slice in order, start one `builder` in the foreground, without `isolation`, so it works in this worktree. Pass `model: "opus"` for a slice marked `opus`. Its prompt holds the issue number, the slice, and the earlier slices' handoffs verbatim. Afterwards, check that the worktree is clean and that the slice's commits are on the branch. A builder that stopped early (a usage limit, a blocker) gets a `SendMessage` to continue, with the most likely way around a blocker. A slice that fails twice is skipped, with the later slices that depend on it, and noted for the PR.

3. **Draft PR.** After the first slice, push and open a draft PR whose body holds `Closes #<issue>` and the slices as a checklist, and remove the issue's `ready-for-agent` label, which marks what still waits for a build. Push after each later slice, and tick it off.

4. **Review.** Start two `reviewer` agents in parallel on `git diff origin/main...HEAD`: the Spec axis with the issue as its brief, and the Standards axis with `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs the diff touches.

5. **Finish.** Start one more `builder` with the job `finish`, the issue number, both reports verbatim and any skipped slices.

6. **Ready.** Push, complete the PR body from the handoffs, mark the PR ready and arm auto-merge (`gh pr merge <pr> --auto --squash`), so the maintainer's approval merges it. Wait for CI with `gh pr checks <pr> --watch` run in the background. A red check goes to a `builder` with its failed log (`gh run view <run> --log-failed`); push its fix and wait again.

7. **Report.** After the last issue, one line per issue: its PR link or what blocked it, and what failed or was skipped. The user accepts the PRs in `/sitting`, which also removes the worktrees of merged PRs.
