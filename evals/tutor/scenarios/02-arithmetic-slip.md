# 02 Partly right with an arithmetic slip

The AI has posed Exercise 17 of the problem sheet (the inverse of a 3×3 matrix by Gaussian elimination), whose printed result is an answer key. The Student uses the right method but makes one arithmetic slip.

## Setup

```json
{
  "examInDays": 30,
  "goal": "good_grade",
  "attempts": [
    { "topics": ["Linear systems and Gaussian elimination"], "daysAgo": 6 },
    {
      "kcs": [
        "Matrix of a linear map",
        "Matrix product and composition",
        "Invertible matrices"
      ],
      "daysAgo": 2
    }
  ],
  "openQuestion": {
    "opening": "Can I practise computing an inverse?",
    "leadIn": "Here is one from the problem sheet. Set up $[A \\mid I]$ and row-reduce until the left side is $I$.",
    "exercise": "**Exercise 17.**"
  }
}
```

The open Question poses Exercise 17, with the key $A^{-1} = \begin{pmatrix} -24 & 18 & 5 \\ 20 & -15 & -4 \\ -5 & 4 & 1 \end{pmatrix}$.

## Persona

A diligent second-year student who is good at procedures and careless with arithmetic. They are confident about their method and will be a bit annoyed if told they "got it wrong" without being shown where.

## Moves

1. Answers with a short account of the method (augmented matrix, row operations they name) and the result with one slip in the last row: $\begin{pmatrix} -24 & 18 & 5 \\ 20 & -15 & -4 \\ -5 & 4 & 2 \end{pmatrix}$.
2. When the AI says something is off, asks "Where exactly?" before looking themselves.
3. Given a hint, finds the slip and sends the corrected last row.
4. If the AI asks for a check, multiplies $A A^{-1}$ for the last row and reports it.

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `grade` first in the reply to the answer, with `finalValues` holding the Student's matrix as mathjs (`[[-24, 18, 5], [20, -15, -4], [-5, 4, 2]]`), so the check reports a mismatch and the result is `partial` (right method, an error), help `none`.
- `compute` to locate the slip (such as multiplying $A$ by the Student's matrix) before telling the Student where it is.

### Tool calls that must not happen

- No `full` result for the KC.
- No full worked solution of the Exercise before the Student has tried to fix the slip.
- No new `ask` before the open Question is graded.

### Qualities the judge looks for

- Acknowledges that the method is right and the first two rows are correct, so the feedback is specific, not "wrong".
- Gives the smallest hint that unblocks: points at the last row or the entry $(3,3)$, or suggests checking with $A A^{-1}$, rather than handing over the correct number.
- Does not re-teach Gauss-Jordan from scratch.
- Cites the Exercise's page as a link from a tool result.
- After the fix, moves on: a short next step (a similar Problem through `findProblems` and `ask`, or a due KC) rather than ending the conversation.
- Never shows ids or tool names.
