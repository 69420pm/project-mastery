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

**Outline**:
A Material's tree of Chapters, found when it is parsed from its headings, the starts of its pages and its PDF outline. Its root Chapter is titled by the Material's name.
_Avoid_: Table of contents, structure

**Chapter**:
One node of a Material's Outline, such as a part, a chapter or a section, with its title as printed and the chunks from its start to the next Chapter's. The map build extracts KCs from whole Chapters, and a Topic covers whole Chapters.
_Avoid_: Section (a Reading section is something else), Part, heading

**Old exam**:
A Chapter the Student confirmed in the Brief as a past exam, together with the Chapters inside it: a whole Material through its root Chapter, or an exam inside a script. Its Exercises count for Priority, and Mock exams are assembled from it.
_Avoid_: Past paper, Altklausur, exam Material

**Brief**:
What a Student told the AI about a Course's exam: its date, their goal, format, excluded Materials, which Chapters are old exams, the exam scope, the Course language and notes, which the AI writes as short paraphrases and the tutor reads as hints. They tell it in a short conversation on the Course's Brief page, which isn't a Chat: the AI asks each question once, accepts "don't know", and ends by sending the Student to the Course map; they can come back with new information any time. The AI proposes the Chapters the parse took for old exams, or whose Material's name looks like one, and asks once about each such Chapter parsed after intake.
_Avoid_: Preferences, intake form, onboarding

**Exam scope**:
A Student-confirmed statement that the exam leaves out (`excluded`) or stresses (`emphasized`) one Topic, in the Student's words; it covers the Topics inside it unless one has its own. The AI proposes one only when an admin text of the Materials or the Student says so.
_Avoid_: Topic choice (a pin or skip is about the study plan, not the exam)

**Knowledge map**:
What a Course's Materials teach, built from them by the AI: its Topic tree, Knowledge components and Prerequisites, with its Exercises. What the Materials assume without explaining stays as text on the KCs that assume it. An update adds what new Materials teach and drops what deleted ones taught; its KCs and Exercises keep their identity across updates. Old exams teach nothing, but their exercises count.
_Avoid_: Topic map, concept map, knowledge graph, syllabus

**Course map**:
The Course's home: its Topics drawn as nested boxes, with the arrows between Topics that their KCs' Prerequisites imply. It shows the Knowledge map at Topic level.
_Avoid_: Dashboard, overview, home page

**Knowledge component (KC)**:
One thing an exam task could test on its own and a Student could learn in one sitting, with the chunks of the Materials that teach it. It also lists, as text, what it assumes that no KC means. Every KC sits in one Topic; a KC whose chunks are all gone is retired and keeps its Attempts.
_Avoid_: Skill, learning objective, concept, node

**Topic**:
A named node of a Course's Topic tree, covering whole Chapters of its Materials, that a Student learns and sees as one. A Topic can hold Topics inside it and KCs of its own; one with KCs of its own has the central question they answer, its anchors (the Prerequisites outside it) and its Reading sections. It keeps its identity across Knowledge map updates while the tree call, or else the new Topic holding most of its Chapters, continues it.
_Avoid_: Big idea, chapter, unit, lesson, module

**Reading section**:
A part of a Topic's source pages, about one to three pages in Material order, cut when read from the chunks its KCs cite. The Student reads the pages as they are.
_Avoid_: Passage, excerpt, reading

**Prerequisite**:
A link saying one KC must be learned before another. The Prerequisites of a Knowledge map form no cycle.
_Avoid_: Dependency, requirement

**Exercise**:
One printed exercise of a Course's Materials with all its subtasks, such as "Ex. 7.2", as a Knowledge map build analyses it: the KCs it tests, a difficulty, its final answers as printed, each an answer key a code check can use (a mathjs expression with a label), and the solution printed in the Materials, if any; without one, the AI solves it with the Student. Its label, such as "Linear maps · Sheet 2 p. 3" (its Chapter, Material and page), is built when read. Its statement is a chunk labelled `exercise`; the subtasks stay in it, so they share the Exercise's KCs and final answers.
_Avoid_: Task, assignment

**Problem**:
An exam-style task a Student solves: an Exercise from the Materials, also from an old exam, a variant of one, or one generated for the KCs it tests.
_Avoid_: Task, exercise (only for those from the Materials)

**Priority**:
How much a KC matters for this Student's exam, computed when read from how many old-exam Exercises and Exercises test it, the Materials the Brief excludes and the exam scope of its Topic or the nearest Topic above it. A KC is at least as high as any KC that builds on it, directly or not, unless the Student excluded it. Without old exams, Exercises or exam scopes every KC is equal, so course order decides.
_Avoid_: Weight, importance, relevance

**Attempt**:
The evidence for one KC from one Question, in a Chat or a Mock exam: whether the Student got it right and how much help they needed. The log of attempts is the only stored learning state. A KC's first UTC day with an Attempt teaches it; on each later day its first Attempt is a Review.
_Avoid_: Answer, result, score

**Review**:
A due KC's first Attempt of a later UTC day, which schedules its next one further out when the Student remembers it. Due Reviews come first in the Ranking.
_Avoid_: Revision, repetition, quiz

**Recall band**:
What the Student sees of a KC, from its recall at the end of the current UTC day: _new_ (not taught), _strong_ (at or above the goal's retention), _fading_ (0.7 or more) or _weak_ (below 0.7).
_Avoid_: KC state, mastery level, status

**Ranking**:
The one ordered list of what is worth doing next in a Course, derived on every read from the map, Priority, the replayed recall, the pace and the plan: due Reviews, the plan's Topics with untaught KCs, refreshes of taught KCs, then the Topics that are _if time allows_; in the final stretch (the exam day and the 7 days before it) everything by value per minute. A Topic never comes before an untaught Topic it builds on.
_Avoid_: Plan order, queue, schedule

**Readiness**:
How much of a Course's exam weight a Student is likely to recall on the exam day: the Priority-weighted recall of its KCs on that day, with 0 for an untaught KC, per Topic and per Course. It shows beside the latest graded Mock exam's score and is never a grade.
_Avoid_: Score, grade, prediction

**Progress**:
How many of the KCs in the study plan a Student has learned (answered fully without help at least once), with the days since the first Attempt and the days to the exam, such as "34 of 120 KCs learned · 12 days in · 30 days left". It falls only when the plan or the map changes. Shown on the Course map and in the Brief's panel.
_Avoid_: Mastery, completion

**If time allows**:
A Topic the Student's goal leaves out of the study plan, which the Student studies only after the plan's Topics. A pin puts it in the plan.
_Avoid_: Optional, left out, out of scope

**Topic choice**:
A Student's _pin_ or _skip_ of a Topic, one at a time. A pinned Topic is always in the study plan and comes first in its order; a skipped Topic never is. A skip's optional reason goes into the Brief's notes.
_Avoid_: Favourite, hide, exclude (an excluded Material is something else)

**Today card**:
The head of the Ranking, on the Course map and in a new Chat: the due Reviews with their minutes, then the next Topic with its minutes, or the first 5 items in the final stretch. Its buttons open a new Chat that sends a first message as the Student: "Let's start.", "Let's review." when Reviews are due and "Exam problems please." once a KC is taught.
_Avoid_: Dashboard, daily plan, agenda

**AI**:
The tutoring intelligence a Student studies with: it explains, asks and gives feedback.
_Avoid_: Tutor, assistant, bot. The code's "tutor context", `TutorTools` and the like name what the AI is given to tutor with, not the AI.

**Chat**:
One ongoing conversation between a Student and the AI within one Course, kept until the Student deletes it or its Course. It is where the AI tutors the Student from the Course's Knowledge map: it gets the facts of their study and a proposal of what to do next, teaches freely, and follows the Student when they want something else.
_Avoid_: Conversation, thread

**Source pane**:
The pane beside a Chat that shows a Material's own pages, at a Reading section or a citation. A citation in the Chat opens the cited page in it.
_Avoid_: Viewer, reader, side panel

**Study session**:
One sitting of study with a start and an end: a Chat, or a Mock exam. Every Chat is one kind of session, ended by the Student, a Session rating or 2 idle hours, and then closed by one model call that writes its notes.
_Avoid_: Lesson, sitting, session alone when a Chat is meant

**Session rating**:
The Student's verdict on a Study session at its close: 1 to 5, with an optional short note.
_Avoid_: Feedback, score, review (a Review asks about a due KC)

**Question**:
One graded ask the AI puts to a Student in a Study session, such as a recall question or a Problem, with the KCs it tests. It shows inline in the Chat. The Student's messages after it, until it is graded, are its answer. Grading its answer gives Attempts.
_Avoid_: Quiz, prompt, task

**Mock exam**:
A timed Study session without help, assembled from old exams or from Problems in the exam's style, and graded afterwards per Problem.
_Avoid_: Practice exam, test, simulation

**Reserved exam**:
An old exam the Student chose in the Brief to keep unseen for their final Mock exam. Until a submitted Mock exam has used it, the AI, Problem generation and the other Mock exams leave its Chapter's Exercises and chunks out; afterwards it counts as an ordinary old exam.
_Avoid_: Held-back exam, hidden exam, final exam

**Memory**:
What the AI noted about a Student in one Course to tutor them better, such as preferences and context, never mastery. The AI adds to it while it tutors and when a session closes; the Student can edit it on the Brief page.
_Avoid_: Profile, notes (the Brief's notes are something else)

**Topic note**:
What the AI noted about a Student's study of one Topic: what clicked, recurring errors and the explanation that worked, never mastery. The close call writes one for each Topic a session's Attempts touched, replacing the old one. The tutor reads it as a hint.
_Avoid_: Topic summary, Topic memory

**Daily limit**:
The most a Student's AI use may cost per day, measured in US dollars.
_Avoid_: Quota, budget, allowance, credits
