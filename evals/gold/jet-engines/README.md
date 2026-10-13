# Gold set: jet engines

The reference course for the Material-to-knowledge-map pipeline ([#51](https://github.com/69420pm/project-mastery/issues/51), "Gold set" and Build order). After every prompt change, the pipeline's output for `material.pdf` is compared with the gold map: KC recall, duplicate rate, prerequisite precision and exercise mapping.

| File             | What it is                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `material.pdf`   | Chapter 7, "The Physics and Engineering of Jet Engines" (pp. 185–189). Fully AI-generated, so it is safe to publish.                                                                            |
| `knowledge.json` | The map built by hand from the chapter: big ideas, KCs, prerequisites, semantic links and tasks. Raw source of the gold map.                                                                    |
| `chunks.json`    | The chapter's chunks from one live parse (`pnpm smoke parse evals/gold/jet-engines/material.pdf --chunks-out …`), without ids, figure boxes or embeddings. Pages count from 1 (printed p. 185). |
| `gold.json`      | The gold Knowledge map in the shape of `courseMapSchema` (`src/features/knowledge-map/schemas.ts`), which a unit test parses it with.                                                           |

## `gold.json`

Converted from `knowledge.json` ([#69](https://github.com/69420pm/project-mastery/issues/69)), which stays unchanged as the raw source:

- KC sources are `position`s in `chunks.json`, read from each KC's `source` page reference. A new parse can number chunks differently, so `chunks.json` and `gold.json` change together.
- Descriptions are the big ideas' `summary` and the KCs' `objective`; Bloom levels are lowercase.
- The `PRE` big idea is gone: its KCs are prior knowledge, with no big idea, Bloom level or source.
- Each `prereq` entry becomes a prerequisite with confidence 1.
- Each free-text `rel` maps to a `coreType`, with the original kept as `label`; `rel`s without a fitting type become `other`.
- Practice items (`items`), `explain`, `misconceptions` and `formula` are dropped.
- `tasks` become `exercises` ([#70](https://github.com/69420pm/project-mastery/issues/70)), without Example 7.1: their question chunk is a `chunks.json` position, task types and difficulties are set by hand, Exercise 7.1 is `disputed` with a `solution_mismatch` finding about chunks 24 and 25, and the rest are `verified`. Exercise 7.2 is one chunk, so 7.2a and 7.2b share it.
- KC07 (propulsive power) and KC26 have `origin` `exercise`: only an exercise teaches them.

`chunks.json` gives each exercise chunk the `solution_position` of its paired solution chunk, or null without one; `pnpm smoke parse --chunks-out` writes it from `exercise_solutions`. The positions in the current file were added by hand.

## `knowledge.json` is not in the #51 format

- big ideas are `bi` ids, prerequisites are a `prereq` list on each KC, and links use free-text `rel` values;
- `tasks` list each example and exercise subtask (7.2a, 7.2b) with its KCs, but have no parent id, solution status, points or difficulty;
- KCs carry `source`, a page reference, and `items` (questions with answers), where #51 has `source_chunk_ids` and separate practice items.

## Known facts to check against

- The chapter's Exercise 7.1 prints 46.5% where the correct answer is 50.8%. A pipeline that checks solutions should report it as a finding.
- Propulsive power (F × V₀) appears only in an exercise, so it should surface as an exercise-derived KC.
