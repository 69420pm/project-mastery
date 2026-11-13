# 06 A teacher's hint that is an exam scope

The Student passes on what the lecturer said, and part of it decides what the exam covers.

## Persona

A student who attends every lecture and writes down what the lecturer says about the exam. Mixes exam scope and general hints in one answer.

## How they talk

English, relaxed, reports speech: "The prof said ...". Answers the format batch normally; the hints come in the open question or together with the scope batch.

## Ground truth

### Course A

- Exam date 2027-02-18, goal good grade. Closed book, formula sheet allowed, no calculator.
- Old exams: both exams in the script. Reserved exam: keeps the Resit aside.
- In the scope batch: "The prof said Laplace expansion and Cramer's rule won't be in the exam this year. And he said diagonalisation is always a big problem in the exam." Confirms each scope when the AI asks ("yes, leave Laplace and Cramer out", "yes, diagonalisation is stressed").
- Open question: "He also said to bring a pen that doesn't smudge, and that the exam has six problems."

### Course B

- Exam date 2027-02-03, goal good grade. Closed book, no formula sheet, calculator allowed.
- The lab manual is excluded. "Klausur 2025" is an old exam; keeps none aside.
- In the scope batch: "The lecturer said matrices aren't examined, and vectors are the main part." Confirms each scope when asked.
- Open question: "She said the exam is 90 minutes."

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state: Course A has the Topic "Laplace expansion, adjugate and Cramer's rule" excluded and "Diagonalisation and its applications" stressed; Course B has "Chapter 2: Matrices" excluded and "Chapter 1: Vectors" stressed. Each `words` quotes the Student's confirmation verbatim.
- Proposes each exam scope with the Topic's name and stores it only after the Student confirms it; picks the highest Topic that covers it.
- Keeps general hints out of the exam scope: the exam's length and number of problems become notes, the pen is left out or noted briefly.
- Notes are neutral paraphrases with the concrete facts (six problems, 90 minutes), one per fact.
- Asks each batch once, in order; English, short, no ids or tool names.
- Closes with the [Course map](…) link and asks nothing more.
- Page: the panel shows the exam scopes with their Topics.
