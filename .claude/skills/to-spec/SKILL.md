---
name: to-spec
description: "Turn the decisions from a grilling session into a one-page spec issue that /build can implement without asking anything."
disable-model-invocation: true
---

You turn what the conversation has settled into a spec: one GitHub issue of about one page that `/build` implements end to end without a user to ask. It fits any code change: a feature, a bug fix, a refactor or a chore.

A spec has two halves. The **top half**, down to `Try it`, is the user's: what they approve now and check by hand after the build. It reads in two minutes without knowing the code. The **bottom half** is yours and the builder's: the user may read it, and nobody asks them to.

## Process

1. **Collect what is settled.** Take the decisions from the conversation and the parent issue, if any. Read only the code they touch, use the words from `GLOSSARY.md`, and follow the ADRs in that area. When a decision about what a Student sees or can do, what their data means or what the app costs to run is missing, ask about that one decision. Settle every other missing decision yourself, with the simplest option that works.

2. **Verify external facts now.** When the spec depends on how a provider or library behaves, check it before the build, within [the live AI rules](../../../docs/agents/live-ai.md), and write what you verified, with the date, into `docs/agents/notes/`.

3. **Cut the scope.** List everything the spec would build beyond what was asked: extra states, retries, concurrency guards, caches, polish, data no feature reads yet. Defer each item unless the change breaks without it, and give it a line in `Not building`, where the user can pull it back in. Storing or duplicating data, and adding a dependency, need an explicit yes even when requested.

4. **Size and slice it.** Split the work into vertical slices in build order, each working and testable on its own across the layers it needs. A **small** spec is one slice, a **feature** two to four. Anything larger is a **bet**: spec only its thinnest version that works end to end, and leave the rest until the user has used that version. Slices run on Sonnet; mark a slice `opus` when it designs new structure, such as a new workflow, schema or model call.

5. **Write the Try it steps.** At most five steps the user takes in the running app, in under five minutes, each with what they should see, that together show the Goal is met. A change with nothing to see names the command that shows it.

6. **Plan the smoke check.** When the change touches a model call, name the [smoke check](../../../docs/agents/live-ai.md) that runs it once on a small real input, for example `pnpm smoke parse e2e/files/lecture-notes.pdf`. If it or the `pnpm smoke` runner doesn't exist yet, building it belongs to the last slice.

7. **Publish.** Fill the template, keeping its `##` headings, with the top half under about 250 words and the whole under about 800. Create the issue as [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) describes, as a sub-issue of the parent if there is one. Reply with the top half as published, the link and `/build <number>`.

## Writing rules

- Write decisions, not stories: "A failed parse sets `failed` with a reason; Retry runs the whole parse again."
- The top half uses the words of `GLOSSARY.md` and of the UI. Tables, columns, states and public functions belong to the bottom half, named where a decision needs them. File paths and code go stale, so leave them to the builder.
- For each overlap or midway failure the scope kept, say what happens in one line.
- State each decision once.

## Template

<spec-template>

## Goal

Two or three sentences: what is different after this ships, for the Student or the codebase, and which part of which parent issue it is.

## Behaviour

What a Student sees and can do, as numbered steps in the order they meet it. For a change without a visible effect: what is true afterwards.

## Not building

What was cut or deferred and why, one line each, so each can become its own issue.

## Try it

1. A step in the running app, and what the user should see.

## Build decisions

Every decision the builder must not guess, each with its reason: modules and interfaces, schema with RLS, states and transitions, model task and cost accounting, failure and overlap behaviour. Group them under `###` subheadings when there are more than about eight.

## Slices

1. **<Name>** (`sonnet` or `opus`): what works end to end after this slice, in one or two sentences.

## Testing

The seams to test at (existing ones, as few as possible), the prior art to copy, and for async behaviour the signal a test waits on. One e2e path for the main flow, if the change has one.

## Smoke check

The command, the input, what it checks and its call budget. Or "None".

## Shipping

Migrations, environment variables, provider settings, and facts still unverified. Or "Nothing beyond the code".

</spec-template>
