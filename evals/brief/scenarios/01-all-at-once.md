# 01 Answers everything at once

An organised Student who read the course information and puts every answer in the first message or two.

## Persona

A second-semester student who has done this before. They read the syllabus, know the exam facts by heart, and want the setup over quickly. They answer more than is asked and never repeat themselves.

## How they talk

English, complete and dense: one long message with date, goal, format, aids and what's in scope. Afterwards short confirmations ("yes", "correct", "none, thanks"). They expect the AI to keep up and get impatient when asked something they already said.

## Ground truth

### Course A

- Exam date 2027-02-18, goal good grade.
- Closed book; one handwritten A4 sheet is allowed (formula sheet yes); no calculator.
- No Material excluded (there is only the script).
- Old exams: both "Final Exam, Winter Term 2025/26" and "Resit Exam, Winter Term 2025/26" in the script. Keeps the Resit aside for the final Mock exam.
- No exam scope.
- Notes: the lecturer said proofs from the lecture can be asked word for word.

Opening message: "Exam is on 18 February 2027, I want a good grade. Closed book, one handwritten A4 sheet allowed, no calculator. Everything in the script is relevant, and the two exams at the end of the script are last year's."

### Course B

- Exam date 2027-02-03, goal good grade.
- Closed book, no formula sheet, calculator allowed.
- The lab manual is excluded.
- Old exams: "Klausur 2025" in the lecture notes. Keeps none aside.
- Chapter 2 is not examined (the admin text says so; the Student confirms when asked).
- Notes: the lecturer said vector addition shows up in every exam.

Opening message: "3 February 2027, aiming for a good grade. Closed book, no formula sheet, calculator is fine. Skip the lab manual; Klausur 2025 is last year's exam."

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state: every ground-truth field matches the database after the run, and nothing the Student did not say is stored.
- The first reply stores date, goal and the whole format in one `saveBrief` call, plus what they said about Materials and old exams.
- Asks only what is still open, in batch order; never asks again for date, goal, format or old exams.
- Course A: proposes both exams by name as "<Material> › <Chapter>" or accepts them from the message; asks the reserved exam right after, listing both. Course B: asks to confirm leaving out Chapter 2 because of the admin text, and stores the exam scope only after "yes", with `words` the Student's confirmation.
- The note is one neutral paraphrase that keeps the concrete fact, not the Student's words.
- Replies are short, in English, and never show ids, field names or tool names.
- Closes after the open question with the [Course map](…) link and asks nothing more.
- Page: the panel shows every stored answer after each reply, without a reload.
