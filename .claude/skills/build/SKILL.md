---
name: build
description: "Build a queue of issues end to end, each in its own worktree: one fresh builder per slice, one review, a live smoke check and a PR that merges on approval, and settle what waits on queued PRs, with no questions after the start. Run it in its own session."
argument-hint: "[issue or pr ...]"
model: haiku
disable-model-invocation: true
---

You coordinate the build of issues, usually specs from `/to-spec`, into PRs ready for review, one at a time. The user is away: where something is open, decide and note it for the PR. `builder` agents write all code. You start them, check their results and run git and GitHub, following [docs/agents/pull-requests.md](../../../docs/agents/pull-requests.md). Every handoff stays in your context, so keep your own messages to a line or two.

Builders and reviewers read the issue and their own instructions themselves. A prompt holds what its step names here, verbatim, and nothing of your own: a rule you add replaces theirs, and an added "no live AI calls" once cost a build its smoke check.

## Queue

Run `tools/build/cleanup.sh` first. Then take the numbers the user names, in that order. Without a number, take every open PR labelled `ready-for-agent`, then every open issue with that label, oldest first (`gh pr list --label ready-for-agent`, `gh issue list --label ready-for-agent --search "sort:created-asc"`). A number that is an open PR is a change request; an issue goes through the steps. Take one to its end, stop its app (`pnpm -s agent down`), leave its worktree with `ExitWorktree` (`keep`), then start the next.

Build an issue as written, all of it. When it cannot be built that way (a dependency that is not merged, a cost you doubt), build none of it: comment on it with what stopped the build, label it `status: blocked` and go on to the next.

## Waiting for a builder

Builders run in the background and notify you when they end. While one runs, keep `sleep 1800` running in the background and start it again when it ends: a builder stopped by the usage limit can fail without a notification, and your next turn is what makes Claude Code wait for the reset. After a reset, send the builder a `SendMessage` to continue from what it committed. A builder that stopped early for another reason (a blocker) gets a `SendMessage` with the most likely way around it.

## A change request

A queued PR waits on its open points: the maintainer's comments, a failed check, a conflict with `main`. `tools/sitting/waiting.sh <pr>` prints them. Enter the PR's worktree (`EnterWorktree` with the path `.claude/worktrees/build-<issue>`, the issue being the number in the PR's branch name) and start one `builder` with the job `change request`, that output verbatim and a red check's failed log (`gh run view <run> --log-failed`). Push, answer on the PR with one line per point (`gh pr comment`), which closes the comments, and take `ready-for-agent` off the PR. Then wait for CI as in step 6.

## Steps

1. **Worktree.** `EnterWorktree` with the name `build-<issue>`, then run `tools/build/setup.sh <issue>` from its root; add a type argument such as `refactor` when the issue's label does not fit the change. [docs/agents/worktrees.md](../../../docs/agents/worktrees.md) lists the commands the worktree accepts. The issue's `## Slices` are your plan, without the ones the issue marks as built. An issue without them is one slice, built from the issue as written.

2. **Slices.** For each slice in order, start one `builder`, without `isolation`, so it works in this worktree. Pass `model: "opus"` for a slice marked `opus`. Its prompt holds the issue number, the slice's line from the issue, and the earlier slices' handoffs. Afterwards, check that the worktree is clean and that the slice's commits are on the branch. A slice that fails twice is skipped, with the later slices that depend on it, and noted for the PR.

3. **Draft PR.** After the first slice, push and open a draft PR whose body holds `Closes #<issue>` and the slices as a checklist, and remove the issue's `ready-for-agent` label, which marks what still waits for a build. Push after each later slice, and tick it off.

4. **Review.** Start two `reviewer` agents in parallel on `git diff origin/main...HEAD`: the Spec axis with the issue as its brief, and the Standards axis with `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs the diff touches.

5. **Finish.** Start one more `builder` with the job `finish`, the issue number, both reports and any skipped slices.

6. **Ready.** Push, complete the PR body from the handoffs, mark the PR ready and arm auto-merge (`gh pr merge <pr> --auto --squash`), so the maintainer's approval merges it. Wait for CI with `gh pr checks <pr> --watch` run in the background. A red check goes to a `builder` with its failed log (`gh run view <run> --log-failed`); push its fix and wait again.

7. **Report.** After the last one, one line per issue or PR: its PR link or what blocked it, and what failed or was skipped. The user approves the PRs on GitHub, and `/sitting` shows what stands in their way.
