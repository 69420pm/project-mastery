# 01 Cold start on a new Course

A Student opens their first Chat on Linear Algebra I. Nothing is taught yet, the exam is six weeks away, and the Brief's notes say they are completely new to linear algebra.

## Setup

```json
{
  "examInDays": 42,
  "goal": "good_grade"
}
```

No Attempts, no Memory, no open Question. The proposal is the first Topic, "Logic and proof".

## Persona

A first-semester student who uploaded the script last night and has never seen linear algebra. Motivated but unsure where to begin, and a little intimidated by the notation. They want the AI to take the lead today, and they get bored by long explanations.

## Moves

1. Opens with something short: "Hi, let's start." or "Where should I begin?"
2. Answers the AI's first question honestly. They know truth tables vaguely from school, so a question on "and" and "or" goes fine, and one on implication comes out half right: they think "A implies B" is false when A is false.
3. When corrected, asks why an implication with a false premise counts as true, since it feels wrong.
4. After an explanation, tries the AI's next question and gets it right.
5. If the AI lectures for more than a paragraph without a question, says "Sorry, that's a lot at once."

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `getTopic` on the proposed Topic ("Logic and proof") or its first KCs before teaching anything from it.
- `ask` for the first diagnostic question in the first or second reply, on a KC of that Topic, so the answer is graded.
- `grade` at the start of the reply after each answer, with one result per KC of the Question: the half-right implication answer is `partial` or `wrong`, not `full`.

### Tool calls that must not happen

- No `grade` of a question that was asked as plain text.
- No `showReading` forced on the Student before they say what they want (offering it in text is fine).
- No `remember` of mastery or scores, such as "knows truth tables".

### Qualities the judge looks for

- Says in one or two sentences what it proposes (start with logic and proof, since everything builds on it) and lets the Student redirect.
- Finds out before teaching: the first substantive move is a short question, not an explanation of the Topic.
- Explains the false-premise case with a concrete everyday example and the script's truth table, then ends in something for the Student to do.
- Cites the script by Material and page, as a link from a tool result, when it teaches from it.
- Short replies, matching a beginner who is easily overwhelmed; notation in LaTeX.
- Never shows ids or tool names.
