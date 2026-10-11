// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";

let signedIn: string | null = STUDENT;
let db = createDb();

/**
 * The Student's tables. `queue_material_parse` stands in for the database
 * function, whose guard pgTAP tests: it queues a `not_parsed` or `failed`
 * Material and says whether it did.
 */
function createDb() {
  return fakeSupabase({
    tables: { materials: [] as FakeRow[] },
    functions: {
      queue_material_parse: ({ material_id }, tables) => {
        const material = tables.materials.find(
          (row) =>
            row.id === material_id &&
            row.owner === signedIn &&
            (row.parse_status === "not_parsed" ||
              row.parse_status === "failed"),
        );
        if (material) material.parse_status = "queued";
        return Boolean(material);
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

const { parseMaterial } = await import("@/features/ingestion/server");
const { startMaterialParse } = await import("./actions");

function seedMaterial(parseStatus: string) {
  db.tables.materials.push({
    id: MATERIAL,
    owner: STUDENT,
    parse_status: parseStatus,
  });
}

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
  startWorkflow.mockReset();
});

describe("startMaterialParse", () => {
  test.each(["not_parsed", "failed"])(
    "starts the parse of a %s Material",
    async (status) => {
      seedMaterial(status);

      const result = await startMaterialParse({ materialId: MATERIAL });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(db.tables.materials[0]?.parse_status).toBe("queued");
      expect(startWorkflow).toHaveBeenCalledExactlyOnceWith(parseMaterial, [
        MATERIAL,
      ]);
    },
  );

  test.each(["queued", "parsing", "parsed"])(
    "does nothing for a %s Material",
    async (status) => {
      seedMaterial(status);

      const result = await startMaterialParse({ materialId: MATERIAL });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(db.tables.materials[0]?.parse_status).toBe(status);
      expect(startWorkflow).not.toHaveBeenCalled();
    },
  );

  test("starts one parse when pressed twice at once", async () => {
    seedMaterial("failed");

    await Promise.all([
      startMaterialParse({ materialId: MATERIAL }),
      startMaterialParse({ materialId: MATERIAL }),
    ]);

    expect(startWorkflow).toHaveBeenCalledOnce();
  });

  test("refuses a signed-out visitor", async () => {
    seedMaterial("failed");
    signedIn = null;

    const result = await startMaterialParse({ materialId: MATERIAL });

    expect(result).toEqual({
      ok: false,
      message: "Sign in again to continue.",
    });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  test("refuses an id that is not a Material's", async () => {
    const result = await startMaterialParse({ materialId: "not-an-id" });

    expect(result.ok).toBe(false);
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});
