# Workflows by default, agents where they pay off

**Context.** Most of the product (ingestion, exam analysis, plan building, review scheduling) is a known sequence of steps. Autonomous agent loops cost more and behave less predictably.

**Decision.** Build fixed pipelines with LLM steps by default. Use agent loops with tools where the path cannot be known in advance, mainly the AI helping a Student study in a Chat (looking up course material, recording mastery, scheduling reviews).

**Consequences.** Lower and more predictable cost per student, and steps that can be tested on their own.
