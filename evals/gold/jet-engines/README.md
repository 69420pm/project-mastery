# Gold set: jet engines

The reference course for the Material-to-knowledge-map pipeline ([#51](https://github.com/69420pm/project-mastery/issues/51), "Gold set" and Build order). After every prompt change, the pipeline's output for `material.pdf` is compared with the gold map: KC recall, duplicate rate, prerequisite precision and exercise mapping.

| File             | What it is                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `material.pdf`   | Chapter 7, "The Physics and Engineering of Jet Engines" (pp. 185–189). Fully AI-generated, so it is safe to publish.         |
| `knowledge.json` | The map built by hand from the chapter: big ideas, KCs, prerequisites, semantic links and tasks. Raw source of the gold map. |

## Not in the #51 format yet

`knowledge.json` predates the Data structures in #51 and differs from them:

- big ideas are `bi` ids, prerequisites are a `prereq` list on each KC, and links use free-text `rel` values;
- `tasks` list each example and exercise subtask (7.2a, 7.2b) with its KCs, but have no parent id, solution status, points or difficulty;
- KCs carry `source`, a page reference, and `items` (questions with answers), where #51 has `source_chunk_ids` and separate practice items;
- nothing points to chunks yet, because there is no parsing step to produce chunk ids.

Converting it into the #51 shape (as `gold.json` next to it) is its own step. Treat `knowledge.json` as read-only input to that conversion.

## Known facts to check against

- The chapter's Exercise 7.1 prints 46.5% where the correct answer is 50.8%. A pipeline that checks solutions should report it as a finding.
- Propulsive power (F × V₀) appears only in an exercise, so it should surface as an exercise-derived KC.
