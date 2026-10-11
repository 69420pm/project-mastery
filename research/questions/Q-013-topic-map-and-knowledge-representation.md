---
id: Q-013
status: awaiting-pdfs
priority: high
principles: [2, 3, 4, 8]
---

# What units should the topic map track, and how should the pipeline build it from the parsed material?

Read [ARCHITECTURE-PROPOSAL.md](../ARCHITECTURE-PROPOSAL.md) for how the topic map fits into the course pipeline and the learning loop. Assume that **parse and OCR** returns the entire material as rich markdown with provenance per chunk.

**Decision:** The shape of the topic map and the "Build topic map" step that produces it: which node types exist, how fine a node is, which edges exist, and whether the map is fixed after the upload or revised from student practice. The planner schedules over this map, the tutor retrieves through it, the item bank is generated per node, and readiness is reported per node, so its errors propagate to every later step.

**Why it's uncertain:** Course materials are written for people, not machines: the same idea appears under several names, slides skip steps the lecturer said aloud, and the order of the lectures is only one of many valid orders. An LLM can produce a plausible-looking graph from them, but plausible is not the same as a map on which mastery estimates are reliable and prerequisites are real.

## Sub-questions

- What unit should mastery be tracked on (topic, concept, skill, learning objective, knowledge component), and at what granularity do estimates stay reliable, given how few practice opportunities a student has before the exam?
- Which knowledge types need distinct treatment (definitions and facts, procedures, concepts and principles, proofs), and does each need different practice and scheduling?
- How accurately can LLMs extract concepts and prerequisite links from course materials, compared to a map built by an expert, and which failure modes are typical?
- Can practice data validate and repair the map after launch, and how much data does that need?

## What would change the design

- If mastery is reliable only at the knowledge-component level, the map needs two layers: fine units for the learner model, and coarser topics for the plan and the readiness view a student reads.
- If knowledge types need different practice, each node carries a type, and the item bank and the tutor's activity choice branch on it.
- If LLM extraction is close to expert quality, the pipeline can run fully automatically; if not, it needs a validation pass, a cap on the number of nodes, or a confirmation step that does not add bureaucracy for the student (principle 8).
- If practice data can repair the map, the map is versioned and the learner model is recomputed from the event log when it changes, as the proposal already allows.

## Outcome

Not researched yet.
