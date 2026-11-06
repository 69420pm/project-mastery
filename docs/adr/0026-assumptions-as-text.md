# Assumptions as text

> Supersedes [ADR 0024](0024-kcs-without-sources.md).

**Context.** ADR 0024 turned what the Materials assume but never explain into KCs without rows in `kc_sources`, so new knowledge had something to dock onto. The first Update map on a real Course (Linear Algebra I, #248) showed the cost. Such a KC needed its own rules in four places: `retire_unsourced_kcs` kept it while a live KC built on it, the Topic tree placed it by the KC that built on it, the Priority rule counted it, and the prompts and the KC panel marked it. It sat in Topic and Readiness state although the Student can learn nothing about it from the Materials, and it gave the tutor a KC with nothing to cite. The map's reason to exist is what the Materials teach.

**Decision.** A KC is something the Materials teach, and every live KC has at least one source. What a KC assumes and no KC means stays on the assuming KC as text.

- **Where it lives.** `kcs.assumes` is a jsonb array of `{ name, description }`, one entry per name (compared case-insensitively). There is no new table, origin or state.
- **Matching.** The Prerequisite check is unchanged: an entry is embedded as "name: description" and offered the 5 nearest live KCs other than the assuming KC, one call per 25 entries. An earlier KC becomes a Prerequisite. A later KC is dropped, since a forward link could make the cycle check drop real Prerequisites. No match, or no candidates, keeps the entry as text. `store_assumed_prerequisites` writes the links, the text and the matched marks in one transaction.
- **Matching again.** When a build stores new KCs, a stored entry is matched again if its 5 nearest live KCs now include one of them. Entries are embedded again, since their vectors are not stored. A match removes the entry and, for an earlier KC, adds the Prerequisite. The step handles 100 entries at a time, so a long Course takes several steps.
- **Merges.** Consolidation's merge unions the merged KCs' entries by name.
- **Retiring.** `retire_unsourced_kcs` retires every live KC without sources, with no exception.
- **Use.** The tutor reads `assumes` as facts about what a KC builds on, to check the Student's footing and explain from the Course's notation.

**Consequences.** The map holds only what the Materials teach, so Topic state, the study plan and Readiness count KCs a Student can actually learn from them. A Student who lacks something the Course assumes meets it as text in the tutor's context, not as a node, and cannot be taught or scheduled on it as a KC. Text that never matches stays on its KC for good; whether entries match too rarely or too often is read from the gold report (#248) and not measured yet. The migration deleted the KCs without sources and marked every extraction unmatched, so the next Update map matches all stored text again, one call per 25 entries.
