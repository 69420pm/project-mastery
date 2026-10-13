import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the build workflow in-process (`build-knowledge-map.ts`):
 * the admin client as a `fakeSupabase`. `replace_knowledge_map` stands in
 * for the database function, which pgTAP tests: it swaps in the map's big
 * ideas, KCs, sources, links, Exercises and Findings while the build runs,
 * and marks it built. Stored ids are "<course>:<local id>".
 */
export function createMapDb(courseId: string) {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      chunks: [] as FakeRow[],
      knowledge_map_builds: [] as FakeRow[],
      big_ideas: [] as FakeRow[],
      kcs: [] as FakeRow[],
      kc_sources: [] as FakeRow[],
      prerequisite_links: [] as FakeRow[],
      semantic_links: [] as FakeRow[],
      exercise_solutions: [] as FakeRow[],
      exercises: [] as FakeRow[],
      exercise_kcs: [] as FakeRow[],
      findings: [] as FakeRow[],
      finding_sources: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    defaults: { ai_usage: () => ({ created_at: new Date().toISOString() }) },
    functions: {
      replace_knowledge_map: (args, tables) => {
        const build = tables.knowledge_map_builds.find(
          (row) =>
            row.course_id === args.p_course_id && row.status === "building",
        );
        if (!build) return false;
        const map = args.p_map as {
          bigIdeas: Array<{ id: string; name: string }>;
          kcs: Array<
            FakeRow & { id: string; bigIdea: string | null; sources: string[] }
          >;
          prerequisites: Array<{ from: string; to: string }>;
          semanticLinks: Array<{ from: string; to: string; label: string }>;
          exercises: Array<FakeRow & { id: string; kcs: string[] }>;
          findings: Array<{ kind: string; text: string; sources: string[] }>;
        };
        const rowId = (id: string) => `${courseId}:${id}`;
        tables.big_ideas = map.bigIdeas.map((bigIdea, position) => ({
          id: rowId(bigIdea.id),
          name: bigIdea.name,
          position,
        }));
        tables.prerequisite_links = map.prerequisites.map((link) => ({
          from_kc: rowId(link.from),
          to_kc: rowId(link.to),
        }));
        tables.semantic_links = map.semanticLinks.map((link) => ({
          from_kc: rowId(link.from),
          to_kc: rowId(link.to),
          label: link.label,
        }));
        tables.kcs = map.kcs.map((kc, position) => ({
          id: rowId(kc.id),
          big_idea_id: kc.bigIdea && rowId(kc.bigIdea),
          name: kc.name,
          description: kc.description,
          type: kc.type,
          bloom: kc.bloom,
          origin: kc.origin,
          position,
        }));
        tables.kc_sources = map.kcs.flatMap((kc) =>
          kc.sources.map((chunkId) => ({
            kc_id: rowId(kc.id),
            chunk_id: chunkId,
          })),
        );
        tables.exercises = map.exercises.map((exercise, position) => ({
          id: rowId(exercise.id),
          question_chunk_id: exercise.questionChunk,
          name: exercise.name,
          task_type: exercise.taskType,
          solution_status: exercise.solutionStatus,
          solution: exercise.solution,
          difficulty: exercise.difficulty,
          position,
        }));
        tables.exercise_kcs = map.exercises.flatMap((exercise) =>
          exercise.kcs.map((kcId) => ({
            exercise_id: rowId(exercise.id),
            kc_id: rowId(kcId),
          })),
        );
        tables.findings = map.findings.map((finding, position) => ({
          id: `finding-${position}`,
          kind: finding.kind,
          text: finding.text,
          position,
        }));
        tables.finding_sources = map.findings.flatMap((finding, position) =>
          finding.sources.map((chunkId) => ({
            finding_id: `finding-${position}`,
            chunk_id: chunkId,
          })),
        );
        Object.assign(build, {
          status: "built",
          check_report: args.p_check_report,
          finished_at: new Date().toISOString(),
        });
        return true;
      },
    },
  });
}
