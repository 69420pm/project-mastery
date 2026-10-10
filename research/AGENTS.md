# Research

This folder holds the evidence behind Project Mastery's product design. It answers decision-shaped questions about learning, tutoring and motivation, and turns the answers into graded design rules for the app. [VISION.md](../VISION.md) is what the questions serve.

Run `/research Q-xxx` to work on a question. Each question ends in its own PR on `docs/research-q-xxx`.

## Layout

Each layer links to the one below, so every rule traces to specific pages of specific papers.

- `questions/Q-xxx-<slug>.md`: a design decision to research, its status and its priority
- `sources/<firstauthor>-<year>-<slug>.md`: one card per paper, shared across questions
- `syntheses/Q-xxx.md`: the answer to one question, with its evidence table
- `design-rules/DR-xxx-<slug>.md`: a rule the app follows, with its grade
- `pdfs/`: full texts, gitignored; the user drops paywalled ones here
- `scripts/lit.mjs`: OpenAlex search and citation lookups (`node scripts/lit.mjs --help`)

## Rules of evidence

- **Every claim cites a source card, and every card cites a DOI that `lit.mjs` returned.** A paper you remember but have not fetched is a lead to look up, never a citation.
- **Numbers and quotes come from the text you read**, copied onto the card with page numbers. A synthesis takes its effect sizes from cards, never from memory.
- **Mark what was read.** A card says `abstract` or `full text`. Abstracts overstate results and leave out boundary conditions, so conclusions resting on abstract-only cards are graded down.
- **Look for the "only when".** Every effect has boundary conditions: population, prior knowledge, material type, delay to test. The design rules live in them.
- **Popularity is not evidence.** Treat famous claims with extra suspicion: Hattie's effect-size rankings, learning styles and growth mindset interventions are cautionary examples. Check the citing literature for failed replications.
- OpenAlex metadata is sometimes wrong (venue, type, garbled abstracts). Use it to find papers and confirm the DOI resolves, then take the facts from the paper.

## Grades

A rule's grade combines the strength of the evidence with its **transfer distance**: how far the studies are from our setting (university STEM students, self-paced study, AI-mediated, outcome measured on a delayed exam). An effect proven on word pairs in a lab and tested after 10 minutes is far from our setting, however robust.

- **A**: several meta-analyses plus classroom or field studies in a close population.
- **B**: robust lab findings plus some field evidence, or A-grade evidence from a distant setting.
- **C**: single studies or theory.
- **D**: expert practice or plausible reasoning.

A question is done when more evidence would not change its rules. What remains uncertain goes into each rule's "how to measure in the app".
