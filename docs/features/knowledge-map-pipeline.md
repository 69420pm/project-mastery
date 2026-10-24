# Knowledge map pipeline

How a Course's Materials become its Knowledge map, and how the Brief and the Priorities work on top of it. This is the feature specified in #51 (built in #52–#59, #69–#70, #83–#86). Terms follow [GLOSSARY.md](../../GLOSSARY.md); the decisions are in [ADR 0007](../adr/0007-ingest-each-upload-once.md), [0008](../adr/0008-workflows-by-default.md) and [0009](../adr/0009-durable-background-jobs.md).

## Stages and order

| Stage         | Starts when                                                 | AI calls (task)                                                                       | Writes                                                                  |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Parse      | A Material is added, or Parse or Retry is pressed           | page reads (`ingest`), file call (`ingest`), embeddings (`embed`), pairing (`ingest`) | `materials`, `material_pages`, `chunks`, `exercise_solutions`           |
| 2. Build      | Build or Update map is pressed on the map page              | `map`, `exercise`, `embed`                                                            | `knowledge_map_builds`, `knowledge_map_chunks` and the map tables       |
| 2b. Topics    | Every build, after its map is stored                        | `topic` (one per Big idea with KCs no Topic holds)                                    | `topics`, `topic_kcs`; the build becomes `built`                        |
| 3. Brief      | The Student sends a message on the Brief page               | `brief` (streamed)                                                                    | `briefs`, `brief_excluded_materials`, `brief_messages`, Finding answers |
| 4. Priorities | The map page opens and something changed since the last run | `priority` (at most one call)                                                         | `kc_priorities`, `priority_runs`                                        |

Parse runs per Material. Build reads only parsed chunks, and Priorities follow a Build. The Brief runs alongside. Parse, Build and Priority runs are durable workflows ([ADR 0009](../adr/0009-durable-background-jobs.md)) with one step per model call. Each step retries on its own; a step that fails for good ends the run with a reason the Student sees.

## 1. Parse

The steps run in order, and a retry resumes at the first unfinished one.

1. **Pages.** Marks the Material `parsing` and lists the pages without a stored result.
2. **Page reads.** One vision call per page returns its units (a slide, section, definition, example, exercise subtask, solution, figure or admin remark) as Markdown with LaTeX and figure boxes. Each unit has a label: `content`, `definition`, `example`, `exercise`, `solution`, `figure` or `admin`.
3. **File call.** One text call groups all units into chunks and reads exam metadata. Code checks that every unit is in exactly one chunk and every page is covered; otherwise the step retries. The chunks replace earlier ones in one transaction.
4. **Embeddings.** Chunks are embedded in batches of 20 for pgvector.
5. **Pairing.** Each exercise subtask of the Course gets its solution: by printed number first, then one content-matching call for the rest. The leftovers are marked `no_solution`.
6. The Material becomes `parsed`.

## 2. Build

A build reads only the chunks that no earlier update processed. A first build starts from an empty map. Each model call is one step, in this order:

1. **Skeleton** (`map`): big ideas and candidate KCs from the outline of the new chunks.
2. **Assignment** (`map`, batches of 10 teaching chunks): which KCs each chunk teaches; it may add KCs. Candidates that no chunk teaches are dropped.
3. **Fill** (`map`, one per big idea with new KCs): type, Bloom level and a sharper description.
4. **Links** (`map`): prerequisites, semantic links and prior knowledge for the new KCs. Code breaks prerequisite cycles and drops redundant prerequisites.
5. **Exercises** (`exercise`, one per new subtask): the KCs it needs, a task type, the model's own solution, and whether a given solution matches. Code sets the difficulty (1 to 3) and the solution status (`verified`, `disputed` or `generated`). A disputed solution becomes a `solution_mismatch` Finding. KCs that exercises propose go through Links again.
6. **Scope** (`map`, only with new `admin` chunks): remarks that exclude or limit exam content become `scope` Findings.
7. **Dedup**: with new KCs, they are embedded (`embed`), and pairs at similarity 0.85 or more go to one merge call (`map`).
8. **Store**: `apply_knowledge_map_update` writes the map in one transaction. Rows keep their ids, so Findings and their answers survive; the chunks are marked processed; the check report is stored (uncovered chunks, ungrounded KCs, orphans, dropped cycle edges, remaining duplicates). With nothing new, no model call is made. The build stays `building` until stage 2b stores the Topics.

## 2b. Topics

Every build ends here, on the stored map and its stored ids ([ADR 0020](../adr/0020-topics.md)). Prior KCs belong to no Topic.

1. **Leavers.** A KC removed from the map or moved to another Big idea leaves its Topic.
2. **Grouping** (`topic`, one per Big idea with a non-prior KC no Topic holds): the model gets the Big idea's KCs (each new or placed, with its first source), the links among them and its stored Topics, and returns Topics with a central question, why it matters and their KCs in teaching order. It is asked for 3 to 10 KCs per Topic and, on an update, to place only the new KCs. Code checks that every new KC appears exactly once, otherwise the step retries. Placed KCs stay in their Topic and stored Topics keep their name and question; only the new KCs' placement and the model's new Topics are taken.
3. **Rules** (code, over all Big ideas): a Topic under 2 KCs merges into the Topic of its Big idea that shares the most Prerequisites and Semantic links with it (ties go to the nearest first source), and a Big idea's only Topic stays. KCs are put in teaching order (the model's, with Prerequisites first). Topics are ordered by Prerequisites between their KCs, then by earliest first source; a cycle breaks at the Topic with the earliest first source.
4. **Store**: `replace_topics` replaces the Course's Topics in one transaction, keeping stored ids, and marks the running build `built`. A step that fails for good, or the Daily limit, fails the build with a reason; the map stays and the next Update map runs this stage again.

**Read.** `loadCourseTopics(courseId)` returns the Topics in Course order with their KCs in teaching order, their anchors (Prerequisites of their KCs from outside, prior KCs included, in map order) and their Reading sections (the cited chunks in Material order, a new section when the Material changes or past 3 pages). Anchors and sections are derived on each read and not stored.

## 3. Brief

The Brief is a conversation, not a workflow. The AI asks five fixed questions in order (exam date, goal, hours per week, format, scope), then asks for notes. It stores each answer as it arrives, through three tools: `saveBrief`, `addNote` and `answerFinding`. Once intake is done, it asks the Course's open Findings one at a time. A reply takes at most five model steps.

## 4. Priorities

- **Trigger.** Opening the map page calls `ensurePriorities`, which queues a run only if the map is built and the map, the Brief or a Finding answer changed since the last run.
- **Base** per KC: `0.5 × exam + 0.25 × exercises + 0.25 × dependents`, each normalized to the largest value. _Exam_ is the points of old-exam subtasks that test the KC; _exercises_ counts the Exercises that test it; _dependents_ counts the KCs that need it, directly or through Prerequisites. Without old-exam points, the base is `0.5 × exercises + 0.5 × dependents`.
- **Multiplier.** 0 when all source chunks of a non-prior KC come from Materials the Brief excludes. Otherwise the model's adjustment (`priority`), clamped to 0–2, defaulting to 1. The model is asked only when there are notes or answered Findings and something changed since its last call; otherwise the stored adjustment is reused.
- **Result.** Priority = base × multiplier, with a reason per factor. `replace_kc_priorities` swaps the Course's priorities in one transaction; a failed run keeps the old ones.

Not built: neither the Brief's goal nor a KC's attempts affect priorities. Attempts and their FSRS replay exist (`study`, [ADR 0019](../adr/0019-fsrs-replay.md)) but only order tutoring; the diagnostic (#51, step 5) has no code yet.

## Daily limit

Every workflow model call, and each Brief reply, checks the Student's Daily limit first, and every call records its tokens and cost in `ai_usage`, under its task. At the limit, a parse or a build fails with that reason, and a priority run keeps its stored adjustment.

## Tables

- **Materials:** `materials`, `material_pages` (page reads, internal), `chunks`, `exercise_solutions`.
- **Map:** `knowledge_map_builds`, `knowledge_map_chunks`, `big_ideas`, `kcs`, `kc_sources`, `prerequisite_links`, `semantic_links`, `exercises`, `exercise_kcs`, `findings`, `finding_sources`, `topics`, `topic_kcs`.
- **Brief:** `briefs`, `brief_excluded_materials`, `brief_messages`. **Priorities:** `kc_priorities`, `priority_runs`. **Usage:** `ai_usage`.

Every table has an `owner` and Row Level Security. Workflows write through the admin client, scoped to the Course and its owner. The queue functions (`queue_material_parse`, `queue_knowledge_map_build`, `queue_priority_run`) write their state only when no run is already going, so two presses start one workflow.

## Where to change things

- **Code:** workflows in `src/features/ingestion/workflows/`, `knowledge-map/workflows/` and `priorities/workflows/`; the Brief handler in `brief/server/`. Pure rules sit in `domain/`, with tests beside them, and prompts in `ai/`.
- **Models:** the tasks are in `AI_TASKS` in `src/lib/ai/models.ts`, each overridable with its `AI_MODEL_*` variable.
- **Checks:** `pnpm test` runs the workflows in-process against `fakeSupabase` and mock models. `pnpm smoke map` checks the map against the jet-engines gold set (`evals/gold/jet-engines/gold.json`), and `pnpm smoke topics` runs stage 2b on the gold map: coverage, order, stable ids on a rerun and one new KC.
