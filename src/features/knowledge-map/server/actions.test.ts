// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";

let signedIn: string | null = STUDENT;
let db = createDb();

/**
 * The Student's tables. The functions stand in for the database ones, whose
 * guards pgTAP tests: the queue moves the Course to `building` unless a
 * build runs, and says whether it did.
 */
function createDb() {
  return fakeSupabase({
    tables: { knowledge_map_builds: [] as FakeRow[] },
    functions: {
      queue_knowledge_map_build: ({ course_id }, tables) => {
        if (signedIn !== STUDENT || course_id !== COURSE) return false;
        const build = tables.knowledge_map_builds[0];
        if (build?.status === "building") return false;
        if (build) Object.assign(build, { status: "building" });
        else tables.knowledge_map_builds.push({ status: "building" });
        return true;
      },
      record_knowledge_map_build_start_failure: (_args, tables) => {
        Object.assign(tables.knowledge_map_builds[0] ?? {}, {
          status: "failed",
          failure_reason: "The build could not start. Try again.",
        });
        return true;
      },
    },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
const startWorkflow = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("workflow/api", () => ({ start: startWorkflow }));

const { buildKnowledgeMap } = await import("@/features/knowledge-map/server");
const { startKnowledgeMapBuild } = await import("./actions");

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
  startWorkflow.mockReset();
});

describe("startKnowledgeMapBuild", () => {
  test("starts one build when pressed twice at once", async () => {
    await Promise.all([
      startKnowledgeMapBuild({ courseId: COURSE }),
      startKnowledgeMapBuild({ courseId: COURSE }),
    ]);

    expect(db.tables.knowledge_map_builds).toEqual([{ status: "building" }]);
    expect(startWorkflow).toHaveBeenCalledExactlyOnceWith(buildKnowledgeMap, [
      COURSE,
    ]);
  });

  test("fails the build with a reason when its workflow cannot start", async () => {
    startWorkflow.mockRejectedValue(new Error("Workflow is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await startKnowledgeMapBuild({ courseId: COURSE });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "failed",
      failure_reason: "The build could not start. Try again.",
    });
  });

  test("refuses a signed-out visitor", async () => {
    signedIn = null;

    const result = await startKnowledgeMapBuild({ courseId: COURSE });

    expect(result).toEqual({
      ok: false,
      message: "Sign in again to continue.",
    });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  test("refuses an id that is not a Course's", async () => {
    const result = await startKnowledgeMapBuild({ courseId: "not-an-id" });

    expect(result.ok).toBe(false);
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});
