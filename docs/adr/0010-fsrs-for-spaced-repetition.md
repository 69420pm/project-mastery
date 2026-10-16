# Spaced repetition: a review ladder now, FSRS later

**Context.** Spaced retrieval is central to [VISION.md](../../VISION.md), and scheduling algorithms are a solved problem. FSRS, the best-studied one, schedules from a memory model whose parameters are fitted to a learner's review history; with no history, it runs on population defaults tuned for flashcards, not for KCs reviewed through problems in a Chat.

**Decision.** Schedule reviews on a fixed review ladder until there is history to fit FSRS (`ts-fsrs`) to (#103). Code replays a KC's attempts in time order (`src/features/study/domain/ladder.ts`) into a level from 1 to 5, with intervals of 1, 3, 7, 14 and 30 days, capped by the exam date. The `attempts` log is the only stored learner state: no per-KC state and no mastery number.

**Consequences.** Scheduling is simple to explain, test and change, and a changed exam date or ladder applies on the next read, since nothing derived is stored. The log keeps what FSRS needs (each attempt's KC, outcome and time), so FSRS can replace the replay later and be fitted from it without a migration of learner state. The app's own work goes into deciding what to review and how to ask.
