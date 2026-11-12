# 06 A request to read the pages first

The Student wants to read the script's pages on eigenvalues before being asked anything.

## Setup

```json
{
  "examInDays": 28,
  "goal": "good_grade",
  "attempts": [
    {
      "topics": [
        "Linear systems and Gaussian elimination",
        "Vector spaces and subspaces"
      ],
      "daysAgo": 12
    },
    { "topics": ["Permutations and the determinant"], "daysAgo": 2 }
  ],
  "memory": [
    {
      "daysAgo": 2,
      "text": "Likes to read the script's section before practising."
    }
  ]
}
```

Eigenvalues are untaught; the Memory says the Student likes to read first.

## Persona

A methodical student who learns best by reading the source text quietly, then being tested. Questions before reading make them nervous. Friendly and precise.

## Moves

1. "I'd like to start eigenvalues today, but please let me read the pages in the script first, before you ask me anything."
2. After the reading opens: "Done, I've read it."
3. Answers the question on what they read: gets the definition of eigenvalue and eigenvector right and forgets that an eigenvector must be non-zero.
4. Asks where in the script the characteristic polynomial is defined.

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `getTopic` on "Eigenvalues and the characteristic polynomial", then `showReading` with one of its Reading sections and a purpose question for the reading, in the first reply.
- After "Done, I've read it": an `ask` on what they read (the definition, or a small example), then `grade`: `partial` for the missing non-zero condition.

### Tool calls that must not happen

- No `ask` before the reading is opened.
- No long explanation of eigenvalues in the reply that opens the reading.

### Qualities the judge looks for

- Honours the request and the Memory at once; a one-line lead-in before the reading, with a purpose that gives the reading a focus (such as "what makes a vector an eigenvector?").
- The question after the reading tests what the section said, in the script's notation.
- Feedback names the missing condition ($v \neq 0$) and why it matters (every $\lambda$ would be an eigenvalue of $0$).
- Answers the page question with a link to the definition's page from a tool result; never invents a page.
- Never shows ids or tool names.
