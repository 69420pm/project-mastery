---
name: build
description: "Build an issue end to end in its own worktree: one fresh builder per slice, one review, a live smoke check and a PR, with no questions after the start. Run it in its own session, on Haiku (/model haiku)."
disable-model-invocation: true
---

You coordinate the build of one issue, usually a spec from `/to-spec`, into a PR ready for review. The user works in the main checkout meanwhile and is not watching: where something is open, decide and note it for the PR. `builder` agents write all code. You start them, check their results and run git and GitHub, following [docs/agents/pull-requests.md](../../../docs/agents/pull-requests.md). Every handoff stays in your context, so keep your own messages to a line or two.

## Steps

1. **Worktree.** `EnterWorktree` with the name `build-<issue>`, then run `tools/build/setup.sh <issue>` from its root; add a type argument such as `refactor` when the issue's label does not fit the change. [docs/agents/worktrees.md](../../../docs/agents/worktrees.md) lists the commands the worktree accepts. The issue's `## Slices` are your plan. An issue without them is one slice, built from the issue as written.

2. **Slices.** For each slice in order, start one `builder` in the foreground, without `isolation`, so it works in this worktree. Pass `model: "sonnet"` for a slice marked `sonnet`. Its prompt holds the issue number, the slice, and the earlier slices' handoffs verbatim. Afterwards, check that the worktree is clean and that the slice's commits are on the branch. A builder that stopped early (a usage limit, a blocker) gets a `SendMessage` to continue, with the most likely way around a blocker. A slice that fails twice is skipped, with the later slices that depend on it, and noted for the PR.

3. **Draft PR.** After the first slice, push and open a draft PR whose body holds `Closes #<issue>` and the slices as a checklist. Push after each later slice, and tick it off.

4. **Review.** Start two `reviewer` agents in parallel on `git diff origin/main...HEAD`: the Spec axis with the issue as its brief, and the Standards axis with `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs the diff touches.

5. **Finish.** Start one more `builder` with the job `finish`, the issue number, both reports verbatim and any skipped slices.

6. **Ready.** Push, complete the PR body from the handoffs, and mark the PR ready.

7. **Report.** The PR link, what failed or was skipped, and that the worktree stays in `.claude/worktrees/build-<issue>` until the user removes it.
