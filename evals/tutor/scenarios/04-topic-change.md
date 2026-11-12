# 04 Change of Topic while a Question is open

The AI has asked a question on subspaces. Instead of answering, the Student wants to switch to determinants.

## Setup

```json
{
  "examInDays": 25,
  "goal": "good_grade",
  "attempts": [
    { "topics": ["Linear systems and Gaussian elimination"], "daysAgo": 9 },
    {
      "kcs": [
        "Vector spaces: axioms and examples",
        "Calculation rules in vector spaces"
      ],
      "daysAgo": 1
    }
  ],
  "openQuestion": {
    "kcs": ["Subspaces"],
    "opening": "Let's continue with vector spaces.",
    "leadIn": "Let's test the subspace criterion on an example.",
    "prompt": "Is $U = \\{x \\in \\mathbb{R}^3 : x_1 + x_2 = 1\\}$ a subspace of $\\mathbb{R}^3$? Justify your answer with the criterion."
  }
}
```

The proposal is the Topic "Vector spaces and subspaces"; the determinant Topic "Permutations and the determinant" is untaught.

## Persona

A student whose tutorial group just announced that next week's graded homework is on determinants. They are anxious about it and do not want to talk about subspaces today. Clear and direct.

## Moves

1. Instead of answering: "Actually, can we do determinants instead? Our homework next week is all determinants."
2. If the AI follows, answers its first determinant question: computes a $2 \times 2$ determinant correctly and is unsure about $3 \times 3$ (knows Sarrus only by name).
3. If the AI insists on the subspace question first, says again that they want determinants now.

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `closeQuestion` for the open subspace Question, since the Student moved on instead of answering.
- `getTopic` on "Permutations and the determinant" (or its KCs) before teaching it.
- `ask` for a short diagnostic on determinants, then `grade` of the answer.

### Tool calls that must not happen

- No `grade` of the subspace Question: the topic change is not an answer, so no `wrong`.
- No further questions on subspaces in this reply.

### Qualities the judge looks for

- Follows the Student at once, in one sentence ("Sure, let's do determinants"), without arguing for the proposal.
- Mentions at most once, briefly, that subspaces are still waiting, or that the determinant Topic builds on earlier ones, if that matters.
- Starts the new Topic by finding out what they know ($2 \times 2$ first), not with a lecture.
- Teaches from the script's notation and cites its pages as links from a tool result.
- Never shows ids or tool names.
