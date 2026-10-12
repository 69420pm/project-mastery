---
name: build
description: "Build a spec issue end to end in its own worktree: one fresh builder per slice, one review, a live smoke check and a PR, with no questions after the start. Run it in its own session, on Haiku (/model haiku)."
disable-model-invocation: true
---

You coordinate the build of one spec, given as an issue number, from start to a PR that is ready for review. The user works on other things in the main checkout meanwhile, so do not ask them anything. Decide, and note the decision for the PR. Your own work is mechanical: the `builder` agents write all code, and you start them, check what they report and handle git and GitHub. Keep your messages short. Every handoff stays in your context, so do not repeat it.

## Steps

1. **Worktree.** Call `EnterWorktree` with the name `build-<issue>`. Then run `tools/build/setup.sh <issue>` from the worktree root. It names the branch after the spec, installs dependencies, links `.env.local` and prints the spec. Read [docs/agents/worktrees.md](../../../docs/agents/worktrees.md) for the commands the worktree accepts. If the spec has no `## Slices` section, stop and say it needs `/to-spec` first.

2. **Slices.** For each slice in order, start one `builder` with the Agent tool, in the foreground and without `isolation`, so that it works in this worktree. Pass `model: "sonnet"` when the slice is marked `sonnet`. The prompt holds only:
   - the spec issue number, and the slice number and name;
   - the handoffs of the earlier slices, verbatim.

   When it reports, check that `git status --porcelain` is empty and that `git log --oneline origin/main..HEAD` shows its commits. If the builder stopped early, send it a message to continue with `SendMessage` instead of starting a new one: after a usage limit, say that the limit has reset; after a blocker, give it the most likely way around. If the same slice fails twice, go on with the later slices that don't depend on it, and write it down for the PR.

3. **Draft PR.** After the first slice, push with `git push -u origin <branch>` and open a draft PR with `gh pr create --draft --base main --title "<type>: <spec title in lower case>" --body-file <file>`. Write the body file with the Write tool into your scratchpad. The body has `Closes #<issue>` and the slice list as a checklist. Tick each slice in the PR body (`gh pr edit --body-file`) as it lands, and push after each slice.

4. **Review.** Once all slices are in, start two `reviewer` agents in parallel on `git diff origin/main...HEAD`: one on the Spec axis, with the spec issue as its brief, and one on the Standards axis, with `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs the diff touches as its brief. Ask for only findings that break something or breach a documented rule, not style preferences.

5. **Finish.** Start one more `builder` with the job `finish`. Its prompt holds the spec issue number, both review reports verbatim, and the list of slices that failed, if any. It fixes the findings, runs the full checks, the e2e suite and the spec's smoke check, and commits.

6. **Ready.** Push. Finish the PR body: what works, decisions the builders made that the spec left open, the smoke result, what could not be verified, and what deploying needs. List new files under `supabase/migrations/` with `git diff --name-only origin/main...HEAD -- supabase/migrations`. Then run `gh pr ready`.

7. **Report.** In a few lines: the PR link, anything that failed or was skipped, and that the worktree stays in `.claude/worktrees/build-<issue>`. The user removes it after the merge, or when leaving this session.
