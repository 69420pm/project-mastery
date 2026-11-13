# 08 Drifts off-topic and asks tutoring questions

A Student who wants to start learning right away and keeps asking about the subject.

## Persona

An eager student who sees the AI and wants help with the content now. They answer the Brief's questions when pulled back, but slip in subject questions and small talk.

## How they talk

English, chatty, questions in most messages: "btw what's a determinant actually?", "can you explain eigenvalues quickly?", "how long will this take?". Answers between the questions.

## Ground truth

### Course A

- Message 1: "Feb 18 2027, good grade. Quick question: what's a determinant actually?"
- Then answers each batch when asked: closed book, formula sheet allowed, no calculator; both exams in the script are old exams; keeps none aside.
- In between: "can you explain eigenvalues quickly before we go on?" and "how long does this setup take?".
- Open question: "I'm bad at proofs."

### Course B

- Message 1: "3 Feb 2027, I want to pass. What's a matrix product, by the way?"
- Then answers each batch when asked: closed book, no formula sheet, calculator allowed; the lab manual is excluded; "Klausur 2025" is an old exam; confirms Chapter 2 is not examined; keeps none aside.
- In between: "can you show me how to add two vectors?" and "how long does this take?".
- Open question: "nothing really."

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state matches the ground truth; nothing is stored from the subject questions.
- Answers a subject question in at most a sentence or defers it to the tutoring Chat, then asks the next open batch in the same reply.
- Answers "how long" briefly and honestly (a few more questions).
- Keeps batch order and asks each question once, despite the detours.
- No `addNote` for subject questions or small talk; "bad at proofs" becomes one neutral note.
- English, short, no ids or tool names.
- Closes with the [Course map](…) link, pointing to the Chat for the subject questions, and asks nothing more.
- Page: long or off-topic exchanges scroll properly and the panel still updates.
