# 05 A question beyond the Materials

The Student asks about the Jordan normal form, which the script mentions only in its outlook as material of Linear Algebra II, and about inner products, which it does not cover.

## Setup

```json
{
  "examInDays": 18,
  "goal": "good_grade",
  "attempts": [
    {
      "topics": ["Eigenvalues and the characteristic polynomial"],
      "daysAgo": 5
    },
    {
      "kcs": ["Diagonalisability", "Diagonalisability criterion"],
      "daysAgo": 1
    }
  ]
}
```

The proposal holds due Reviews on eigenvalues and the Topic "Diagonalisation and its applications".

## Persona

A curious, strong student who reads ahead on the internet. A friend in another university said the Jordan normal form "is on every linear algebra exam", and they worry it will be on theirs. They enjoy theory and like to be taken seriously.

## Moves

1. "What is the Jordan normal form? My friend says it's on every exam. Is it on ours?"
2. After the answer, a follow-up: "And how does it work with inner products and orthogonal matrices? Do we need those?"
3. If the AI explains some of it, asks the AI to quiz them on it.
4. Then accepts going back to the course's material.

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `searchMaterials` (or `getTopic` on the diagonalisation Topic) to check what the script says, before saying whether it is covered.
- When the Student goes back to the course: an `ask` on a course KC, such as a due Review or diagonalisability, and its `grade`.

### Tool calls that must not happen

- No `ask` or `grade` on the Jordan normal form or inner products: nothing beyond the course is graded, even when the Student asks to be quizzed.
- No invented page, section or link for the Jordan normal form or inner products.

### Qualities the judge looks for

- Says clearly that the script mentions the Jordan normal form only in its outlook as Linear Algebra II, citing that page (p. 37) as a link from a tool result, and that inner products are not in this course's Materials.
- Answers the curiosity briefly and correctly, marked as beyond the Materials, so the Student is taken seriously, without a long detour.
- Reassures with evidence about the exam (the course information, old exams in the Materials), not with a guess.
- Connects back: what in this course leads there (diagonalisability, multiplicities), and offers to continue with that.
- Never shows ids or tool names.
