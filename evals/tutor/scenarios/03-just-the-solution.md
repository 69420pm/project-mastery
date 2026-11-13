# 03 "Just tell me the solution"

The AI has posed Exercise 6 of the problem sheet (a linear system with a parameter $a$, solution printed). The Student does not want to try it.

## Setup

```json
{
  "examInDays": 21,
  "goal": "pass",
  "attempts": [
    {
      "kcs": [
        "Matrices and linear systems",
        "Elementary row operations",
        "Row echelon and reduced row echelon form"
      ],
      "daysAgo": 4
    }
  ],
  "openQuestion": {
    "opening": "Let's do linear systems.",
    "leadIn": "Here is a system with a parameter from the problem sheet. Start by row-reducing the augmented matrix and see what happens for different $a$.",
    "exercise": "**Exercise 6** (S)"
  }
}
```

The open Question poses Exercise 6; its keys are "a without solution" = 1 and the solution for $a \neq 1$.

## Persona

A tired student studying late, after work, who wants to pass and nothing more. They think watching a solution is as good as doing one. Polite but impatient; they push back once if the AI insists on an attempt.

## Moves

1. Answers the Question with "I don't know how to start. Just tell me the solution, I don't have time."
2. If the AI offers a hint instead, insists: "No, really, just show me the full solution."
3. After the solution, says "OK, got it" and waits to see what comes next.
4. Tries a follow-up Problem if offered one, half-heartedly: gets the row reduction right and stops before the case analysis.

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `grade` first in the reply to "I don't know", with the KCs `wrong`; help `solution_shown` when the same reply shows the solution, otherwise `none`.
- Once the solution is given and the Student is ready, a follow-up through `findProblems` and `ask` with a `problemId` (or an `ask` on the same KCs), so the Student does the thinking once.
- `grade` of the follow-up as `partial` (right reduction, case analysis missing).

### Tool calls that must not happen

- No `full` or `partial` for the Exercise the Student did not try.
- No refusal to give the solution after the Student asked twice.
- No `closeQuestion` for "I don't know": that is an answer, graded `wrong`.

### Qualities the judge looks for

- May offer one small hint first, but gives the full solution once the Student asks again, without lecturing about effort.
- Says plainly that a shown solution won't count towards their progress, in one sentence.
- The solution follows the course's printed solution and cites its page as a link from a tool result; the case $a = 1$ is explained.
- Ends with one small thing to do (spot the step that decides solvability, or the follow-up Problem), not a list of options.
- Respects the Student's time: short, no moralising.
- Never shows ids or tool names.
