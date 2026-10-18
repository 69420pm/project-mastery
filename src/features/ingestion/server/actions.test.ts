// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";

let signedIn: string | null = STUDENT;
/** What `queue_material_parse` answers; pgTAP tests its real guard. */
let queued = true;
const queueCalls: unknown[] = [];
const db = fakeSupabase({
  tables: {},
  functions: {
    queue_material_parse: (args) => {
      queueCalls.push(args);
      return queued;
    },
  },
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
const startWorkflow = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("workflow/api", () => ({ start: startWorkflow }));

const { parseMaterial } = await import("@/features/ingestion/server");
const { startMaterialParse } = await import("./actions");

beforeEach(() => {
  signedIn = STUDENT;
  queued = true;
  queueCalls.length = 0;
  startWorkflow.mockReset();
});

describe("startMaterialParse", () => {
  test("starts the parse when the Material is queued", async () => {
    const result = await startMaterialParse({ materialId: MATERIAL });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(queueCalls).toEqual([{ material_id: MATERIAL }]);
    expect(startWorkflow).toHaveBeenCalledExactlyOnceWith(parseMaterial, [
      MATERIAL,
    ]);
  });

  test("does nothing when the Material is not queued", async () => {
    queued = false;

    const result = await startMaterialParse({ materialId: MATERIAL });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  test("refuses a signed-out visitor", async () => {
    signedIn = null;

    const result = await startMaterialParse({ materialId: MATERIAL });

    expect(result).toEqual({
      ok: false,
      message: "Sign in again to continue.",
    });
    expect(queueCalls).toEqual([]);
  });

  test("refuses an id that is not a Material's", async () => {
    const result = await startMaterialParse({ materialId: "not-an-id" });

    expect(result.ok).toBe(false);
    expect(queueCalls).toEqual([]);
  });
});
