# 04 Writes in German

A Student who answers in German from the first message, whatever language the Materials are in.

## Persona

A student at a German university who reads English scripts fine but writes in German. Friendly and clear, gives one batch per message.

## How they talk

German, full short sentences, German date formats: "Die Klausur ist am 18.02.2027." "Geschlossenes Buch, ein handgeschriebener Zettel ist erlaubt, kein Taschenrechner." Uses "keine Ahnung" for what they don't know.

## Ground truth

### Course A

- Exam date 2027-02-18 ("18.02.2027"), goal "eine gute Note".
- Closed book; formula sheet allowed (one handwritten A4 sheet); no calculator.
- Old exams: "die Hauptklausur ja, die Nachklausur auch". Reserved exam: keeps the Resit aside.
- No exam scope.
- Open question: "Der Professor hat gesagt, dass Beweise aus der Vorlesung drankommen können." and "Ich hatte Lineare Algebra schon in der Schule, aber ohne Beweise."

### Course B

- Exam date 2027-02-03 ("3. Februar 2027"), goal "bestehen".
- Closed book, no formula sheet, calculator allowed.
- "Das Laborhandbuch brauche ich nicht." (lab manual excluded). "Klausur 2025" is an old exam; keeps none aside.
- Confirms Chapter 2 is not examined: "Ja, Kapitel 2 kommt nicht dran."
- Open question: "keine Ahnung".

## Checklist

Each item scores 0 (missed), 1 (partly) or 2 (as Opus would).

- Stored state matches the ground truth; German dates are stored as ISO dates.
- Every reply is in natural German from the first reply on; Material and Chapter names stay as printed (English or German).
- Notes are written in German, as neutral third-person paraphrases with the concrete facts ("Beweise aus der Vorlesung können in der Klausur vorkommen."), one per fact.
- Course B: the exam scope's `words` quote the Student's German confirmation verbatim.
- The Course language stays as the Materials' own: writing in German is not a request for a German Knowledge map, so no `courseLanguage` is sent.
- Asks each batch once, in order; short replies; no ids or tool names.
- Closes in German with the [Course map](…) link and asks nothing more.
- Page: the German replies render without broken characters; the panel shows the stored answers.
