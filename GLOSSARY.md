# Project Mastery

An AI tutor that helps university students master their course material and prepare for exams. This glossary fixes the words the product, the code and the agents use for its concepts.

## Language

**Student**:
A person preparing for an exam with Project Mastery. "User" refers only to the sign-in account behind a Student.
_Avoid_: User, learner

**Course**:
One course a Student is preparing an exam for, named by the Student. It holds that course's Chats and Materials; deleting it deletes them too.
_Avoid_: Topic, subject, class, folder

**Material**:
A file a Student uploaded to one Course, such as slides, a script, an exercise sheet or an old exam, under a name the Student can change.
_Avoid_: File, document, upload, attachment

**Knowledge map**:
What a Course's Materials teach, built from them by the AI: its Big ideas, Knowledge components, Prerequisites and Semantic links, with its Exercises and Findings. An update adds what new Materials teach and drops what deleted ones taught; its KCs, Exercises and Findings keep their identity across updates.
_Avoid_: Topic map, concept map, knowledge graph, syllabus

**Big idea**:
One of the few main themes of a Course's Knowledge map, which groups its Knowledge components.
_Avoid_: Topic, chapter, unit, module

**Knowledge component (KC)**:
One thing a Student can learn and be tested on, such as a fact, concept, procedure or decision, with the chunks of the Materials that teach it. Prior knowledge is a KC the Materials assume but do not teach.
_Avoid_: Skill, learning objective, concept, node

**Prerequisite**:
A link saying one KC must be learned before another. The Prerequisites of a Knowledge map form no cycle.
_Avoid_: Dependency, requirement

**Semantic link**:
A named relation between two KCs, such as "is a" or "contrasts with", that orders no learning.
_Avoid_: Relation, edge, association

**Exercise**:
One exercise subtask of a Course's Materials, such as "Ex. 7.2b", as a Knowledge map build analyses it: the KCs it tests, a task type, a difficulty and whether its solution was verified, disputed or generated. Its question is a chunk labelled `exercise`; an exercise with several subtasks is several Exercises.
_Avoid_: Task, problem, question

**Finding**:
Something a Knowledge map build found wrong in a Course's Materials, such as a printed solution that does not match the AI's, with the chunks it is about.
_Avoid_: Issue, error, erratum

**AI**:
The tutoring intelligence a Student studies with: it explains, asks and gives feedback.
_Avoid_: Tutor, assistant, bot

**Chat**:
One ongoing conversation between a Student and the AI within one Course, kept until the Student deletes it or its Course.
_Avoid_: Conversation, thread, session

**Daily limit**:
The most a Student's AI use may cost per day, measured in US dollars.
_Avoid_: Quota, budget, allowance, credits
