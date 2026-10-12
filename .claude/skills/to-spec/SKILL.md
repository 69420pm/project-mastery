---
name: to-spec
description: "Turn the decisions from a grilling session into a one-page spec issue that /build can implement without asking anything."
disable-model-invocation: true
---

You turn what the conversation has settled into a spec: one GitHub issue of about one page that `/build` implements end to end without a user to ask. It fits any code change: a feature, a bug fix, a refactor or a chore. The spec is the last point where the user can cheaply veto a decision, so it must be short enough to read in two minutes.

## Process

1. **Collect what is settled.** Take the decisions from the conversation and the parent issue, if any. Read only the code they touch, use the words from `GLOSSARY.md`, and follow the ADRs in that area. When a decision the builder would have to guess is missing, ask about that one decision.

2. **Verify external facts now.** When the spec depends on how a provider or library behaves, check it before the build, within [the live AI rules](../../../docs/agents/live-ai.md), and write what you verified, with the date, into `docs/agents/notes/`.

3. **Cut the scope.** List everything the spec would build beyond what was asked: extra states, retries, concurrency guards, caches, polish, data no feature reads yet. Put the whole list to the user in one `AskUserQuestion` round, keep or defer per item, with defer recommended unless the change breaks without it. Storing or duplicating data, and adding a dependency, need an explicit yes even when requested.

4. **Slice it.** Split the work into vertical slices in build order, each working and testable on its own across the layers it needs. A small change is one slice; more than four means the spec is too big to build in one run. Mark a slice `sonnet` when it follows a pattern the codebase already has; the rest run on Opus.

5. **Plan the smoke check.** When the change touches a model call, name the [smoke check](../../../docs/agents/live-ai.md) that runs it once on a small real input, for example `pnpm smoke parse e2e/files/lecture-notes.pdf`. If it or the `pnpm smoke` runner doesn't exist yet, building it belongs to the last slice.

6. **Publish.** Fill the template, keeping its `##` headings, in under about 800 words. Create the issue as [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) describes, as a sub-issue of the parent if there is one. Reply with the link and `/build <number>`.

## Writing rules

- Write decisions, not stories: "A failed parse sets `failed` with a reason; Retry runs the whole parse again."
- Name tables, columns, states and public functions where a decision needs them. File paths and code go stale, so leave them to the builder.
- For each overlap or midway failure the scope kept, say what happens in one line.
- State each decision once.

## Template

<spec-template>

## Goal

Two or three sentences: what is different after this ships, for the user or the codebase, and which part of which parent issue it is.

## Decisions

Every decision the builder must not guess: modules and interfaces, schema with RLS, states and transitions, model task and cost accounting, failure and overlap behaviour, what the UI shows. Group them under `###` subheadings when there are more than about eight.

## Slices

1. **<Name>** (`opus` or `sonnet`): what works end to end after this slice, in one or two sentences.

## Testing

The seams to test at (existing ones, as few as possible), the prior art to copy, and for async behaviour the signal a test waits on. One e2e path for the main flow, if the change has one.

## Smoke check

The command, the input, what it checks and its call budget. Or "None".

## Deferred

What was cut and why, one line each, so each can become its own issue.

## Shipping

Migrations, environment variables, provider settings, and facts still unverified. Or "Nothing beyond the code".

</spec-template>
