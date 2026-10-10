---
name: research
description: Research one question from questions/ and turn the evidence into design rules. Usage /research Q-xxx
disable-model-invocation: true
argument-hint: Q-xxx
---

Research question $ARGUMENTS. The question file's `status` decides where to start:

- `open`: run Phase 1.
- `awaiting-pdfs`: run Phase 2.
- `done`: ask the user what should be deepened before doing anything.

The templates for every file you write are in [templates.md](templates.md).

## Budget

These caps keep a question at roughly 150–250k tokens. When you hit one, stop and record it under "Gaps" in the synthesis. A later run can deepen the question.

- Screen up to 30 search hits in total.
- Write up to 10 new source cards. Reuse existing cards in `sources/` freely.
- Read up to 4 papers in full.
- Run one skeptic pass.

## Phase 1: frame, search, screen

1. **Branch.** From an up-to-date `main`, create `docs/research-<question id in lowercase>`.
2. **Frame.** Sharpen the question file: the decision it informs, its sub-questions, and what answer would change the design. If the question is still a topic ("spacing"), rewrite it as a decision ("how far apart should reviews be when the exam is 9 days away?") and tell the user what you changed.
3. **Search top-down.** Look for practice guides, systematic reviews and meta-analyses first (`search --reviews`), then primary studies only where the reviews leave a sub-question open. Snowball from the 1–2 key reviews: `refs` for their foundations, `cited-by` for later replications and boundary conditions. Run at least one search aimed at counter-evidence ("failed replication", "no effect", "boundary conditions", "expertise reversal").
4. **Screen.** Keep the sources closest to our setting and strongest in design. Prefer one good meta-analysis over five primary studies that it already covers.
5. **Card.** Write an abstract-level card for each kept source, unless `sources/` already has one.
6. **Pick full texts.** Choose up to 4 papers the answer will rest on. For each one, try `node scripts/lit.mjs pdf <doi>`; it saves open-access PDFs to `pdfs/`.
7. **Pause.** Set the question's status to `awaiting-pdfs`, commit, and give the user:
   - the shortlist, one line per source with why it was kept
   - the "PDFs wanted" list: the papers that had no open-access PDF, with DOI and title, so the user can drop them into `pdfs/` as `<doi with / replaced by _>.pdf`

   Phase 1 is done when every kept source has a card and the user has the PDFs wanted list.

## Phase 2: read, synthesize, challenge, decide

1. **Read.** Read each full text in `pdfs/` for this question. If a wanted PDF is missing, carry on with that card abstract-only. Move each card to `full text` and fill in what the abstract hid: design details, effect sizes with uncertainty, the delay to the test, boundary conditions, and quotes with page numbers.
2. **Synthesize.** Write `syntheses/Q-xxx.md`. Answer each sub-question, citing cards. Where studies conflict, say which and why (population, material, outcome measure, delay). Give effect sizes in plain language too ("about a letter grade on a delayed test").
3. **Challenge.** Spawn the `skeptic` agent with the synthesis path. Revise the synthesis for every point it raises: either change the claim, or record under "Challenges" why the point does not hold. A new source it surfaces counts against the card cap.
4. **Decide.** Write a design rule for each change the evidence supports. Check `design-rules/` first and update an existing rule rather than duplicating it. Give each rule its grade, what would change our mind, and how to measure it in the app. Link the rules from the synthesis and the question.
5. **Ship.** Set the question's status to `done`. Commit, push, and open a PR titled `docs(research): <question title in lowercase>`. Its body lists the rules with their grades and the caps that were hit.

Phase 2 is done when every sub-question has an answer with a confidence grade, every skeptic point is resolved in the synthesis, and the PR is open.
