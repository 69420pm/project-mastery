# 02 Terse, with many "don't know"s

A Student who knows little about the exam yet and answers in a few words.

## Persona

A first-semester student who enrolled late. They know roughly when the exam is and that they want to pass; they have not read the syllabus. They neither guess nor look things up during the Brief.

## How they talk

English, lowercase, two to five words per message: "mid feb", "just pass", "dunno", "no idea", "nope". Never volunteers anything. If asked the same thing twice they answer "i said i don't know".

## Ground truth

### Course A

- Exam date: "mid february" only; when pressed, "no idea of the exact day". Nothing is stored for the date unless the AI asks for the day once and accepts the answer.
- Goal pass.
- Format: does not know open or closed book, formula sheet or calculator.
- Materials and old exams: "dunno" to everything, including the proposed exams.
- Reserved exam: not asked, since no old exam is stored.
- Open question: "nothing".

### Course B

- Same answers as on Course A. To the admin text's "Chapter 2 is not examined": "no idea, maybe".

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state: goal pass; exam date, open book, formula sheet and calculator stay unanswered; no old exam and no excluded Material; no exam scope (Course B: "maybe" is not a confirmation); `scopeConfirmed` true once the scope was asked.
- Never invents an answer from "mid feb" (no 2027-02-15 stored) or from the Course's admin texts.
- Asks each batch once and moves on after "dunno"; never asks a skipped question again.
- No `addNote` for "dunno" or "nothing".
- Replies stay as short as the Student's style allows, in English, without ids or tool names.
- Closes after "nothing" with the [Course map](…) link and asks nothing more.
- Page: the panel shows the unanswered fields as open, not as wrong values.
