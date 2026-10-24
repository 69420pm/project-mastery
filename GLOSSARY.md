# Project Mastery

An AI tutor that helps university students master their course material and prepare for exams. This glossary fixes the words the product, the code and the agents use for its concepts.

## Language

**Student**:
A person preparing for an exam with Project Mastery. "User" refers only to the sign-in account behind a Student.
_Avoid_: User, learner

**Course**:
One course a Student is preparing an exam for, named by the Student. It holds that course's Chats and Materials; deleting it deletes them too.
_Avoid_: Subject, class, folder

**Material**:
A file a Student uploaded to one Course, such as slides, a script, an exercise sheet or an old exam, under a name the Student can change.
_Avoid_: File, document, upload, attachment

**Brief**:
What a Student told the AI about a Course's exam: its date, their goal, weekly hours, format, excluded Materials and notes. They tell it in a conversation on the Course's Brief page, which isn't a Chat.
_Avoid_: Preferences, intake form, onboarding

**Knowledge map**:
What a Course's Materials teach, built from them by the AI: its Big ideas, Knowledge components, Prerequisites and Semantic links, with its Exercises and Findings. An update adds what new Materials teach and drops what deleted ones taught; its KCs, Exercises and Findings keep their identity across updates, and answered Findings keep their answers.
_Avoid_: Topic map, concept map, knowledge graph, syllabus

**Big idea**:
One of the few main themes of a Course's Knowledge map, which groups its Knowledge components and Topics.
_Avoid_: Theme, chapter, module

**Knowledge component (KC)**:
One thing a Student can learn and be tested on, such as a fact, concept, procedure or decision, with the chunks of the Materials that teach it. Prior knowledge is a KC the Materials assume but do not teach.
_Avoid_: Skill, learning objective, concept, node

**Topic**:
A named unit of a few KCs of one Big idea that a Student learns and sees as one, with the central question it answers, its anchors (the Prerequisites outside it) and its Reading sections. It keeps its identity across Knowledge map updates.
_Avoid_: Chapter, unit, lesson, module

**Reading section**:
A part of a Topic's source pages, about one to three pages in Material order, that a Student reads as the original pages, annotated pages or a study text written from them.
_Avoid_: Passage, excerpt, reading

**Prerequisite**:
A link saying one KC must be learned before another. The Prerequisites of a Knowledge map form no cycle.
_Avoid_: Dependency, requirement

**Semantic link**:
A named relation between two KCs, such as "is a" or "contrasts with", that orders no learning.
_Avoid_: Relation, edge, association

**Exercise**:
One exercise subtask of a Course's Materials, such as "Ex. 7.2b", as a Knowledge map build analyses it: the KCs it tests, a task type, a difficulty and whether its solution was verified, disputed or generated. Its statement is a chunk labelled `exercise`; an exercise with several subtasks is several Exercises.
_Avoid_: Task, assignment

**Problem**:
An exam-style task a Student solves: an Exercise or old-exam subtask from the Materials, a variant of one, or one generated for the KCs it tests.
_Avoid_: Task, exercise (only for those from the Materials)

**Finding**:
Something a Knowledge map build asks the Student about a Course's Materials, with the chunks it is about: something that looks wrong, such as a printed solution that does not match the AI's, or a remark that limits the exam's content, such as "not exam-relevant". It is open until the Student answers it in the Brief, and then answered.
_Avoid_: Issue, error, erratum

**Priority**:
How much a KC matters for this Student's exam, from old exams, Exercises, the Knowledge map and the Brief.
_Avoid_: Weight, importance, relevance

**Attempt**:
The evidence for one KC from one Question: whether the Student got it right and how much help they needed. The log of attempts is the only stored learning state.
_Avoid_: Answer, result, score

**Review**:
Asking about a due KC again, to schedule its next one further out when the Student remembers it.
_Avoid_: Revision, repetition, quiz

**KC state**:
Where a KC stands for a Student, from its FSRS card replayed from its attempts: _new_ (no attempts besides prequestions), _learning_ (its first Study session is still open, or its card's stability is under 7 days and it isn't due), _due_ (its next review is today or earlier) or _known_ (any other KC with a card).
_Avoid_: Mastered, mastery level, status

**Readiness**:
How much of a Course's exam weight a Student is likely to recall on the exam day, from the projected recall of the KCs that matter weighted by Priority, and checked against graded Mock exams. It is never a grade.
_Avoid_: Score, grade, prediction

**Phase**:
Where a Course's study stands before its exam, derived by code: _build_ (teaching the KCs that matter), _deepen_ (all taught; exam-style practice and weak KCs) or _final week_ (Review only).
_Avoid_: Period. A Stage and a mode belong to a Study session, not to a Course.

**AI**:
The tutoring intelligence a Student studies with: it explains, asks and gives feedback.
_Avoid_: Tutor, assistant, bot. The code's "tutor context", `TutorTools` and the like name what the AI is given to tutor with, not the AI.

**Chat**:
One ongoing conversation between a Student and the AI within one Course, kept until the Student deletes it or its Course. It is where the AI tutors the Student from the Course's Knowledge map.
_Avoid_: Conversation, thread

**Study session**:
A Chat with a mode: _learn_ (one Topic), _review_ (due KCs), _practice_ (exam-style Problems), _mock exam_ or _results_ (going through a graded Mock exam), with a start and an end.
_Avoid_: Lesson, sitting, session alone when a Chat is meant

**Stage**:
Where a Learn session stands in teaching its Topic: _orient_, _prime_, _read_, _work_, _apply_, _rebuild_ or _close_.
_Avoid_: Step, phase (a Phase belongs to a Course)

**Question**:
One graded ask the AI puts to a Student in a Study session, such as a prequestion, a recall question, a Problem or the rebuild of a Topic, with the KCs it tests. Grading its answer gives Attempts.
_Avoid_: Quiz, prompt, task

**Mock exam**:
A timed Study session without help, assembled from old exams or from Problems in the exam's style, and graded afterwards per subtask.
_Avoid_: Practice exam, test, simulation

**Memory**:
What the AI noted about a Student in one Course to tutor them better, such as preferences and context, never mastery. The Student can edit it on the Brief page.
_Avoid_: Profile, notes (the Brief's notes are something else)

**Daily limit**:
The most a Student's AI use may cost per day, measured in US dollars.
_Avoid_: Quota, budget, allowance, credits
