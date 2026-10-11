---
id: DR-004
grade: D
questions: [Q-013]
---

# Version the map and log attempts against stable KC ids so it can be repaired from pooled data

Every course map has a version. KCs keep stable ids across versions, with explicit split and merge records. Every attempt event names the item and the KC ids it was tagged with at the time. When a map changes, the learner model is recomputed from the event log. The architecture proposal already makes the log the source of truth.

When several students share a course map, the pipeline periodically checks learning curves per KC and proposes splits or merges for review. With one student, it only flags suspects: a KC whose correctness does not improve across opportunities, or one failed on one task type and passed on others.

**Rationale:** Data-driven refinement of an existing KC model found a hidden sub-skill that experts had missed, and fixing it improved learning in a classroom RCT. Learning curves can also judge LLM-generated KCs. But this needs tens of thousands of steps, finds only local splits and merges, and is out of reach with one student per course ([Q-013](../syntheses/Q-013.md), sub-question 4). The grade is D because the only closed-loop evidence is one experiment in high-school geometry, far from a single student's exam preparation. The rule is cheap insurance, not a proven lever.

**Boundaries:** Large structural errors (wrong topics, missing chapters) will not be found this way; they belong to the pipeline checks in [DR-002](DR-002-build-map-from-anchored-kcs.md).

**What would change our mind:** If courses are almost never shared by several students, the refinement loop never runs, and only the flagging part is worth keeping.

**How to measure in the app:**

- Count the students per course map.
- For shared maps, track how often a proposed split or merge improves held-out prediction.
- For flagged KCs, track how often a review confirms a map error.
