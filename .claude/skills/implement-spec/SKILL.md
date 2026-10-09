---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, notes, and previous commits. Don't duplicate information already available via pointers: the agent definitions in `.claude/agents/` and `docs/agents/worktrees.md` carry every standing rule (setup, commands, database, AI quota, ports, git), so prompts leave them out.

## Budget

Every agent re-reads its whole context on every turn, and all agents share the user's usage limit. Keep at most **3 implementers** running at once; reviews and the explorer don't count. Pick each implementer's model from its ticket: the default (Opus) for tickets that touch concurrency, persistence, auth, AI streaming or a new architectural seam; `model: "sonnet"` for tickets that follow a pattern the codebase already has.

## Steps

1. Read the spec and tickets to understand the task graph. Make a **notes directory** outside the repo (in your scratchpad) for notes on this spec.

2. Create the integration branch from `origin/main` and check it out in the main checkout: merges run there. Push it.

3. (optional) When tickets need library or codebase knowledge that `docs/agents/notes/` doesn't hold yet, run an `explorer` agent in the foreground, before any implementer, with the questions and the notes directory. Commit any new `docs/agents/notes/` files to the integration branch, so that every worktree has them.

4. For each ticket on the frontier, spawn an `implementer` agent in the background with `isolation: "worktree"`. The prompt holds only: the integration branch, the ticket number, the notes directory and the handoff files in it that this ticket builds on, and what tickets running in parallel change, so that the implementer leaves those parts alone.

5. When an implementer reports, save its reply as `handoff-<ticket>.md` in the notes directory. Then run `tools/spec-run/merge-ticket.sh <ticket-branch>` in the background, one merge at a time. The script prints why it failed, and its header says who fixes each exit code: send that output to the ticket's implementer with `SendMessage`, and run the script again once it reports. If that implementer can't be resumed, spawn a new one for the same ticket. After the first green merge, open the draft PR if the tracker closes work through PRs, marked as closing the spec and tickets.

6. After each green merge, spawn a `reviewer` agent in the background on the Spec axis: the diff of that merge (`git diff <before>..<after>`, both commits printed by the script), the ticket, and the spec sections the ticket names. Send its findings to the ticket's implementer, then merge again as in step 5.

7. When a merge changes the frontier, start implementers for the newly unblocked tickets (step 4).

8. Once all tickets are merged, call the Skill tool with `code-review` against `main`. Send Spec findings to an `implementer` with the default model, and Standards findings to an `implementer` with `model: "sonnet"`. Merge their branches with the script.

9. When the spec changed prompts or AI behaviour that an eval covers, ask the user before running it once with `ALLOW_LIVE_AI=1 pnpm evals <name>`.

10. Finish the PR body: the `Closes` lines, plus what deploying needs beyond the code (new migrations to apply to staging, environment variables, provider settings). Mark the PR ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

11. Remove the implementer worktrees with `git worktree remove` and delete their ticket branches.
