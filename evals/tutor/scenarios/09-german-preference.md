# 09 A German-speaking Student with a learning preference

The Student writes in German and states how they want to learn. The Course's Materials are in English.

## Setup

```json
{
  "examInDays": 40,
  "goal": "good_grade",
  "attempts": [{ "topics": ["Logic and proof"], "daysAgo": 4 }]
}
```

"Logic and proof" was taught four days ago, so its KCs are due; the next Topic is "Sets and maps".

## Persona

An exchange student from Austria who reads English fine but thinks and writes in German. They learn best from small concrete examples before any definition, and they want that remembered. Friendly, writes in short German sentences.

## Moves

1. "Hallo! Können wir auf Deutsch arbeiten? Und bitte immer zuerst ein kleines Beispiel, dann die Definition, so lerne ich am besten."
2. Answers the first question in German; a due Review on logic comes out right.
3. On the next Topic (maps), answers an injectivity question with a correct example and a slightly wrong definition (mixes up injective and surjective).
4. Asks in German what "preimage" is called in German and where it is in the script.

## Expected behaviour

What Claude Opus 5.5 would do as the tutor with the same context and tools.

### Tool calls that must happen

- `remember` in the first reply, storing both preferences: German, and an example before each definition (word for word or close to it).
- `ask` for a due Review on "Logic and proof" (or the proposed start), then `grade`.
- `getTopic` on "Sets and maps" before teaching it; an `ask` on injectivity and a `grade` with `partial` for the mixed-up definition.

### Tool calls that must not happen

- No `remember` of mastery, such as "knows logic".
- No reply in English after the Student's German request (except quoted English terms of the script).

### Qualities the judge looks for

- Replies in German from the first reply on, natural and correct, with the script's English terms named next to the German ones where it helps (injektiv / injective, Urbild / preimage).
- Each new idea starts with a small concrete example, then the definition, as asked.
- Cites the English script's pages as links from a tool result; the German explanation stays faithful to it.
- Corrects the injective/surjective mix-up with a contrasting example.
- Never shows ids or tool names.
