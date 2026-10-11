---
id: DR-002
grade: C
questions: [Q-013]
---

# Build the map from task-anchored, de-duplicated KCs with soft prerequisite edges

The "Build topic map" step drafts KCs and topics with an LLM, then applies four checks before the map is used:

1. **Anchor.** Every KC links to at least one source chunk. Every exercise and old exam task in the upload maps to at least one KC. A KC with no possible task is a heading, not a KC: merge it upward or drop it.
2. **Merge.** Near-duplicate KCs (the same skill worded differently) are merged; over-broad KCs that cover several distinct task types are split.
3. **Bound.** The number of KCs fits the student's available practice time. It is not set by how many headings the material has.
4. **Soften.** Prerequisite edges carry a confidence. The planner may use them to order and suggest, but never to lock content. In particular, a concept never locks a procedure or vice versa.

**Rationale:** LLM KCs match expert KCs only partly and err in both directions: too general (GPT-4 on multiple-choice questions) or far too many (GPT-4o-mini). Merging closes part of the gap. Zero-shot prerequisite judgments were wrong about one time in four even with given concepts, and worse precision is likely on a sparse course graph. Procedural and conceptual knowledge build each other, so neither should gate the other ([Q-013](../syntheses/Q-013.md), sub-questions 2 and 3). The anchoring and coverage checks follow from the definition of a KC as visible in tasks; they have no direct evidence of their own (grade D within this rule).

**Boundaries:** Does not prescribe the prompts, the model or the merge method. For courses with no exercises or old exams, anchoring falls back to generated items, which is weaker.

**What would change our mind:** An end-to-end evaluation showing that an LLM map built straight from course material, without these checks, fits student practice data as well as a checked one. Or evidence that hard prerequisite gating improves exam results for university students.

**How to measure in the app:**

- Build an eval set of a few real courses with a hand-checked map. Track KC match, edge precision and recall, and coverage of old exam tasks per pipeline version.
- Once several students share a course, check learning curves per KC: a flat or jagged curve flags a KC to split or merge.
- Log how often students override a prerequisite suggestion and how they then do.
