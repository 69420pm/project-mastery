# 07 The final stretch, with a graded mock and due Reviews

Four days before the exam. The Student wrote a Mock exam yesterday from three problems of the Final exam of winter term 2025/26 and lost most points on the eigenvalue problem and the parameter system. They open the Chat from the mock's page ("Go through it with the tutor"), so this Chat goes through the mock. Several KCs are due for Review.

## Setup

```json
{
  "examInDays": 4,
  "goal": "pass",
  "attempts": [
    {
      "topics": [
        "Linear systems and Gaussian elimination",
        "Vector spaces and subspaces"
      ],
      "daysAgo": 14
    },
    {
      "topics": [
        "Independence, bases and dimension",
        "Linear maps and rank-nullity"
      ],
      "daysAgo": 10
    },
    {
      "topics": ["Permutations and the determinant"],
      "daysAgo": 8,
      "result": "partial"
    },
    {
      "topics": ["Eigenvalues and the characteristic polynomial"],
      "daysAgo": 6,
      "result": "partial",
      "help": "some"
    }
  ],
  "mock": {
    "daysAgo": 1,
    "items": [
      {
        "exercise": "tx + y + z",
        "points": 10,
        "awarded": 4,
        "answer": "Row reduction gives (t-1) and (t+2)(t-1) on the diagonal. No solution for t = 1. Unique otherwise.",
        "reasons": [
          { "points": 3, "reason": "Row reduction correct" },
          {
            "points": 1,
            "reason": "Cases identified, but t = 1 and t = -2 swapped: t = 1 gives infinitely many solutions"
          },
          { "points": 0, "reason": "Unique solution not computed" }
        ]
      },
      {
        "exercise": "1 & 3 & 2",
        "points": 10,
        "awarded": 8,
        "answer": "rank f = 2, ker f spanned by (1, -1, 1), im f spanned by the first two columns.",
        "reasons": [
          { "points": 8, "reason": "Rank, kernel and image correct" },
          { "points": 0, "reason": "Matrix in the basis B not attempted" }
        ]
      },
      {
        "exercise": "4 & 1 & -1",
        "points": 12,
        "awarded": 3,
        "answer": "chi_A = (x-3)(x-4)(x-5), eigenvalues 3, 4, 5, so A is diagonalisable.",
        "reasons": [
          {
            "points": 2,
            "reason": "Method for the characteristic polynomial right, an expansion error gives the wrong factors"
          },
          {
            "points": 1,
            "reason": "Conclusion follows from the wrong eigenvalues"
          },
          { "points": 0, "reason": "Eigenspaces and A^n missing" }
        ]
      }
    ]
  }
}
```

The tutor context holds the final stretch's Ranking (due Reviews among the first items) and the mock's tasks, most points lost first.

## Persona

A stressed student who wants to pass in four days. They have little patience for theory now and want to know what will bring points. They work hard when they see the point of a task.

## Moves

1. Opens with the mock page's message: "Let's go through my mock exam."
2. Agrees to start where they lost most, and tries the redone step the AI gives them; makes an expansion error again on the first try, then gets it with a hint.
3. Asks: "Should I still learn theory, or only do old exam problems?"
4. Works one more exam-like problem the AI poses.
5. Near the end: "What should I do tomorrow?"

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- Starts from the mock task with most points lost (the eigenvalue problem), reading its KCs with `getTopic` when it teaches from them.
- `ask` on a step of a lost task or on an exam-like Problem found with `findProblems` (the course's old-exam problems first), each followed by `grade`, with `compute` to check the Student's characteristic polynomial.
- At least one due Review asked and graded in the session, mixed in with the exam work.

### Tool calls that must not happen

- No re-grading of the mock: its points stand.
- No `ask` that uses the Reserved exam, which the AI does not see.
- No long theory lecture without a problem attached.

### Qualities the judge looks for

- Names what went wrong in the mock, task by task and in order of points lost, using the grading reasons, in a few lines.
- Teaches through exam problems: each explanation is attached to a problem step the Student then does.
- Answers the theory question honestly for the goal "pass" in four days: the theory that the old exams ask about (definitions, criteria), learned through problems.
- Gives a concrete plan for tomorrow from the Ranking: due Reviews first, then the weakest exam-type problems.
- Calm, encouraging, short.
- Never shows ids or tool names.
