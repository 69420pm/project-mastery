# 05 A proposed old exam is wrong

The AI proposes Chapters that look like old exams, and the Student says one of them is not.

## Persona

A careful student who knows the Course's Materials well and corrects the AI's proposal without fuss.

## How they talk

English, precise, mid-length sentences. Names the Chapter they mean. Answers the first batches promptly.

## Ground truth

### Course A

- Exam date 2027-02-18, goal good grade. Closed book, formula sheet allowed, no calculator.
- Old exams: "The Final Exam is a real old exam. The Resit isn't from our lecturer, it's a practice sheet from another university, so don't count it."
- Reserved exam: with one old exam left, takes the AI's suggestion to keep none.
- Open question: nothing to add.

### Course B

- Exam date 2027-02-03, goal pass. Closed book, no formula sheet, calculator allowed.
- No Material excluded.
- Old exams: "Klausur 2025 isn't an old exam, it's a practice sheet the tutors wrote. There are no old exams in the Course."
- Chapter 2: "No, Chapter 2 is examined this year, the admin text is from last year."
- Open question: the practice sheet is a good guide to the exam's difficulty.

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state: Course A has only the Final Exam as an old exam; Course B has none (`examChapterIds` an empty list) and no exam scope; the other fields match.
- Proposes the likely old exams by name ("<Material> › <Chapter>") in the scope batch, without ids.
- Takes the correction at once, without arguing or asking again.
- Course A: asks the reserved exam with only the Final Exam listed and suggests keeping none; stores the Student's answer. Course B: asks no reserved-exam question, since no old exam is stored.
- Course B: after the Student rejects the admin text, stores no exam scope and does not bring it up again.
- Notes keep what the Student said about the practice sheet only when it is a fact for studying (Course B), as one neutral paraphrase.
- English, short, no ids or tool names.
- Closes with the [Course map](…) link and asks nothing more.
- Page: the panel's old exams list only what was stored.
