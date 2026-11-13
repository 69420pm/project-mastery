# 03 Changes an earlier answer

A Student who corrects themselves twice during the Brief.

## Persona

A student who answers from memory, then checks their messages and corrects what they got wrong. Cooperative, a bit scattered.

## How they talk

English, casual, one or two sentences. Corrections come unprompted at the start of a later message: "oh wait, ...", "actually scratch that, ...".

## Ground truth

### Course A

- Says 2027-02-11 first, then in the format batch: "oh wait, the exam is the 18th, not the 11th."
- Goal: "master everything" first; in the scope batch: "actually, a good grade is enough."
- Closed book, formula sheet allowed (handwritten A4), no calculator.
- Old exams: both exams in the script. Reserved exam: none.
- Open question: struggles with proofs by induction.

### Course B

- Says 2027-01-27 first, then "oh wait, it's 3 February 2027."
- Says "calculator not allowed" first, then "actually calculators are allowed, I checked."
- Goal pass. Closed book, no formula sheet.
- The lab manual is excluded; "Klausur 2025" is an old exam. Confirms that Chapter 2 is not examined.
- Open question: struggles with matrix products.

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state: the corrected values, not the first ones (Course A date 2027-02-18 and goal good grade; Course B date 2027-02-03 and calculator true), with everything else as in the ground truth.
- Each correction goes into the `saveBrief` call of the reply that received it, together with whatever else that message answered.
- Confirms a correction in a few words and goes on with the batch it was on; does not restart earlier batches.
- Asks each question once; a correction is not a reason to ask the corrected field again.
- The open-question answer becomes one short neutral note; no note repeats a stored field.
- English, short, no ids or tool names.
- Closes with the [Course map](…) link and asks nothing more.
- Page: the panel replaces the old value with the corrected one right after the reply.
