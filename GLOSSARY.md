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
What a Student told the AI about a Course's exam: its date, their goal, weekly hours, format, excluded Materials, which Materials are old exams, the exam scope and notes. They tell it in a conversation on the Course's Brief page, which isn't a Chat. The AI proposes the Materials whose names look like old exams, and asks once about each Material parsed after intake.
_Avoid_: Preferences, intake form, onboarding

**Exam scope**:
A Student-confirmed statement that the exam leaves out (`excluded`) or stresses (`emphasized`) one Big idea or Topic, in the Student's words. The AI proposes one only when an admin text of the Materials or the Student says so.
_Avoid_: Topic choice (a pin or skip is about the study plan, not the exam)

**Knowledge map**:
What a Course's Materials teach, built from them by the AI: its Big ideas, Knowledge components and Prerequisites, with its Exercises. An update adds what new Materials teach and drops what deleted ones taught; its KCs and Exercises keep their identity across updates.
_Avoid_: Topic map, concept map, knowledge graph, syllabus

**Course map**:
The Course's home: its Topics on its Big ideas, with the arrows between Topics that their KCs' Prerequisites imply. It shows the Knowledge map at Topic level.
_Avoid_: Dashboard, overview, home page

**Big idea**:
One of the few main themes of a Course's Knowledge map, which groups its Knowledge components and Topics.
_Avoid_: Theme, chapter, module

**Knowledge component (KC)**:
One thing a Student can learn and be tested on, such as a fact, concept, procedure or decision, with the chunks of the Materials that teach it. Every KC sits in one Big idea.
_Avoid_: Skill, learning objective, concept, node

**Topic**:
A named unit of a few KCs of one Big idea that a Student learns and sees as one, with the central question it answers, its anchors (the Prerequisites outside it) and its Reading sections. It keeps its identity across Knowledge map updates.
_Avoid_: Chapter, unit, lesson, module

**Topic state**:
Where a Student stands on a Topic, the first that holds: needs work (a KC's FSRS card has lapsed 3 or more times), solid (every KC has a card whose recall on the exam date, or today without an exam ahead, reaches the goal's retention), learned (every KC is taught), in progress (some KC is taught) or new.
_Avoid_: Topic status, Topic progress

**Reading section**:
A part of a Topic's source pages, about one to three pages in Material order, cut when read from the chunks its KCs cite. The Student reads the pages as they are.
_Avoid_: Passage, excerpt, reading

**Prerequisite**:
A link saying one KC must be learned before another. The Prerequisites of a Knowledge map form no cycle.
_Avoid_: Dependency, requirement

**Exercise**:
One exercise subtask of a Course's Materials, such as "Ex. 7.2b", as a Knowledge map build analyses it: the KCs it tests, a difficulty, its final answers and the solution printed in the Materials, if any. Its statement is a chunk labelled `exercise`; an exercise with several subtasks is several Exercises.
_Avoid_: Task, assignment

**Problem**:
An exam-style task a Student solves: an Exercise or old-exam subtask from the Materials, a variant of one, or one generated for the KCs it tests.
_Avoid_: Task, exercise (only for those from the Materials)

**Map Finding**:
What the tutor files in a Study session when the Course's sources show the Knowledge map is wrong: a missing or wrong Prerequisite between two KCs, or a wrong KC description with the description it proposes, with a quote from the chunk that shows it. The Student accepts or dismisses it on the Course map; accepting applies the change at once, unless a new Prerequisite would close a cycle, which refuses the accept.
_Avoid_: Issue, error, erratum

**Priority**:
How much a KC matters for this Student's exam, computed when read from how many old-exam Exercises and Exercises test it, the Materials the Brief excludes and the exam scope of its Topic or Big idea. Without old exams, Exercises or exam scopes every KC is equal, so course order decides.
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

**If time allows**:
A Topic the Student's goal leaves out of the study plan, which the Student studies only after the plan's Topics. A pin puts it in the plan.
_Avoid_: Optional, left out, out of scope

**Won't fit**:
An untaught Topic of the study plan that the Student's weekly hours, at their measured pace and after the review load, leave no time for before the final week, with every Topic after it in the plan order.
_Avoid_: Left out, cut, overflow

**Topic choice**:
A Student's _pin_ or _skip_ of a Topic, one at a time. A pinned Topic is always in the study plan and comes first in its order; a skipped Topic never is. A skip's optional reason goes into the Memory.
_Avoid_: Favourite, hide, exclude (an excluded Material is something else)

**Today card**:
What the study plan says to do next, on the Course map and in a new Chat: the due Reviews with their minutes, the next Topic, the Phase's hint and a start button per available Study session mode: Learn with a next Topic, Review with Reviews due, Practice with a learned Topic.
_Avoid_: Dashboard, daily plan, agenda

**AI**:
The tutoring intelligence a Student studies with: it explains, asks and gives feedback.
_Avoid_: Tutor, assistant, bot. The code's "tutor context", `TutorTools` and the like name what the AI is given to tutor with, not the AI.

**Chat**:
One ongoing conversation between a Student and the AI within one Course, kept until the Student deletes it or its Course. It is where the AI tutors the Student from the Course's Knowledge map.
_Avoid_: Conversation, thread

**Source pane**:
The pane beside a Chat that shows one thing at a time: a Material's own pages, at a Reading section or a citation, or a Topic's part of the Knowledge map after its rebuild. A citation in the Chat opens the cited page in it.
_Avoid_: Viewer, reader, side panel

**Study session**:
A Chat with a mode: _learn_ (one Topic), _review_ (due KCs), _practice_ (exam-style Problems), _mock exam_ or _results_ (going through a graded Mock exam), with a start and an end.
_Avoid_: Lesson, sitting, session alone when a Chat is meant

**Stage**:
Where a Learn session stands in teaching its Topic: _review_ (the due Reviews it opens with), _orient_, _prime_, _read_, _work_, _apply_, _rebuild_ or _close_.
_Avoid_: Step, phase (a Phase belongs to a Course)

**Session rating**:
The Student's verdict on a Study session at its close: 1 to 5, with an optional short note.
_Avoid_: Feedback, score, review (a Review asks about a due KC)

**Question**:
One graded ask the AI puts to a Student in a Study session, such as a prequestion, a recall question, a Problem or the rebuild of a Topic, with the KCs it tests. Grading its answer gives Attempts.
_Avoid_: Quiz, prompt, task

**Mock exam**:
A timed Study session without help, assembled from old exams or from Problems in the exam's style, and graded afterwards per subtask.
_Avoid_: Practice exam, test, simulation

**Reserved exam**:
An old exam the Student chose in the Brief to keep unseen for their final Mock exam. Until a submitted Mock exam has used it, the AI, Problem generation and the other Mock exams leave its Exercises and chunks out; afterwards it counts as an ordinary Material.
_Avoid_: Held-back exam, hidden exam, final exam

**Memory**:
What the AI noted about a Student in one Course to tutor them better, such as preferences and context, never mastery. The Student can edit it on the Brief page.
_Avoid_: Profile, notes (the Brief's notes are something else)

**Topic note**:
What the AI noted about a Student's study of one Topic: what clicked, recurring errors and the explanation that worked, never mastery. Each learn session on the Topic replaces it when it closes; the tutor reads it as a hint.
_Avoid_: Topic summary, Topic memory

**Session note**:
Two lines the AI writes when a Study session closes: what happened and what is next. The tutor reads the last three of a Course as hints.
_Avoid_: Session summary, session log

**Pinned line**:
A Memory line starting with `!`. Condensing the Memory keeps it word for word.
_Avoid_: Starred line, protected line

**Daily limit**:
The most a Student's AI use may cost per day, measured in US dollars.
_Avoid_: Quota, budget, allowance, credits
