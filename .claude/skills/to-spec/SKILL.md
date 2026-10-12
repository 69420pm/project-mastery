---
name: to-spec
description: "Turn the decisions from a grilling session into a one-page spec issue that /build can implement without asking anything."
disable-model-invocation: true
---

You turn what the conversation has settled into a spec: one GitHub issue of about one page that `/build` implements end to end without a user to ask. The spec is also the last point where the user can cheaply veto a decision, so it must be short enough for them to read in two minutes.

Read [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) for how issues are created and labelled.

## Process

1. **Collect what is settled.** Take the decisions from the conversation. Read the parent issue if there is one. Look only at the code the decisions touch, use the words from `GLOSSARY.md`, and follow the ADRs in that area. Do not interview the user again. If a decision is missing, ask about that one decision.

2. **Check external facts once.** When the spec depends on how a provider or library behaves (a model's output, a quota, the shape of a response), check it now instead of during the build. A few calls to `gemini-3.5-flash-lite` are fine for this ([docs/agents/worktrees.md](../../../docs/agents/worktrees.md#shared-resources)). Write what you verified, with the date, into `docs/agents/notes/`.

3. **Cut the scope.** List everything the spec would build that the parent issue or the user's request did not ask for: extra states, retries and resume, concurrency guards, caches, polish, data that no feature reads yet. Ask the user about the whole list in one `AskUserQuestion` round: keep or defer each item, with defer as the recommended option unless the feature breaks without it. Any decision that stores or duplicates data, or adds a dependency, needs the user's explicit yes even when it was in the request. Deferred items go into the spec's Deferred section.

4. **Slice it.** Split the work into 2–4 vertical slices, in build order. Each slice works end to end on its own (schema, server, UI as needed), so it can be tested on its own. Do not split by layer. Give each slice a model:
   - `opus` (the default): new design, persistence or concurrency, AI calls, auth.
   - `sonnet`: the slice follows a pattern the codebase already has, such as a page or a CRUD action like an existing one.

5. **Plan the smoke check.** When the feature calls a model, name a command that runs the real feature once on a small real input and checks its invariants, for example `pnpm smoke parse e2e/files/lecture-notes.pdf`. It uses flash-lite and at most 10 model calls. Smoke checks live in `evals/smoke/` ([Project structure](../../../docs/ARCHITECTURE.md#project-structure)). If the check, or the `pnpm smoke` runner, does not exist yet, building it is part of the last slice. Without model calls, write "None".

6. **Write and publish.** Use the template below, keep its `##` headings exactly, and stay under about 800 words. Create the issue with `gh issue create`, labelled `type: feature` (or `type: bug`) and `ready-for-agent`, as a sub-issue of the parent if there is one. Reply with the issue link and the command to build it: `/build <number>`.

## Writing rules

- Write decisions, not stories. "A failed parse sets `failed` with a reason; Retry runs the whole parse again" is a decision. No user-story lists.
- Name tables, columns, states and public functions where a decision needs them. Leave out file paths and code, which go stale.
- Say what happens when actions overlap or fail midway, but only for the overlaps the scope kept. One line each.
- Each decision appears once. Do not repeat it in Goal or Testing.

## Template

<spec-template>

## Goal

Two or three sentences: what the user can do after this ships, and which step of which parent issue it is.

## Decisions

Grouped under `###` subheadings when there are more than about eight (for example Schema, Pipeline, UI). Every decision the builder must not guess: modules and interfaces, schema with RLS, states and their transitions, model task and cost accounting, failure and overlap behaviour, and what the UI shows.

## Slices

1. **<Name>** (`opus`): what works end to end after this slice, in one or two sentences.
2. ...

## Testing

The seams to test at (prefer existing ones, and as few as possible), the prior art to copy, and for async behaviour the signal a test waits on. One e2e path for the main flow.

## Smoke check

The command, the input file, what it checks, and its call budget. Or "None".

## Deferred

What was cut from this spec and why, one line each, so it can become its own issue later.

## Shipping

Migrations to apply to staging and production, environment variables, provider settings, and facts still unverified. Or "Nothing beyond the code".

</spec-template>
