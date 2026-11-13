# 07 Comes back after the close with new information

The Student finished the Brief earlier and returns with news from the lecture.

## Setup

```json
{
  "answered": {
    "examInDays": 60,
    "goal": "good_grade",
    "openBook": false,
    "formulaSheet": true,
    "calculator": false,
    "notes": "New to proofs; wants to practise them early."
  }
}
```

The Brief is done: the answers above, the scope confirmed, every proposed old exam confirmed, no reserved exam kept.

## Persona

A student who left the Brief a few weeks ago and now opens it again because the lecturer announced changes. Wants the news stored and nothing else.

## How they talk

English, to the point, one piece of news per message, three messages in all. Ends with "that's all, thanks".

## Ground truth

### Course A

- Message 1: "The exam moved to 4 March 2027."
- Message 2: "We're not allowed the formula sheet anymore."
- Message 3: "The lecturer said there'll be a bonus of 10% for the weekly sheets. That's all, thanks."

### Course B

- Message 1: "The exam moved to 4 March 2027."
- Message 2: "We don't need the lab manual after all."
- Message 3: "The lecturer said the exam is 90 minutes. That's all, thanks."

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state: exam date 2027-03-04; Course A formula sheet false; Course B the lab manual excluded; the third fact a new note; the setup's other answers and its note unchanged.
- Each piece of news is stored in the reply that receives it, with the right tool and arguments (Course B: `excludedMaterialIds` with the lab manual).
- Each reply confirms the change in one line and asks no question: no new batch, no "anything else?".
- Does not redo the intake or ask again about goal, format, old exams or the reserved exam.
- The new note is a neutral paraphrase with the concrete fact; the old note is kept.
- English, short, no ids or tool names.
- After "that's all, thanks" a short goodbye, at most with the [Course map](…) link.
- Page: the panel updates after each reply.
