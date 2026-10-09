import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UploadOutcome } from "@/lib/supabase/upload";

const OWNER = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-0000-0000-0000-000000000001";

const storage = vi.hoisted(() => ({
  outcome: "uploaded" as UploadOutcome,
  uploaded: [] as string[],
  removed: [] as string[],
}));
const registered = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/supabase/upload", () => ({
  uploadFile: async ({ path }: { path: string }) => {
    storage.uploaded.push(path);
    return storage.outcome;
  },
  removeUploadedFile: async (_bucket: string, path: string) => {
    storage.removed.push(path);
  },
}));
vi.mock("@/features/courses/server/actions", () => ({
  registerMaterial: async ({ materialId }: { materialId: string }) => {
    registered.calls++;
    return { ok: true, data: { id: materialId } };
  },
}));

const { useMaterialUploads } = await import("./use-material-uploads");

const pdf = () =>
  new File(["%PDF-1.7"], "Lecture 1.pdf", { type: "application/pdf" });

function renderUploads() {
  return renderHook(() =>
    useMaterialUploads({ ownerId: OWNER, courseId: COURSE }),
  );
}

beforeEach(() => {
  storage.outcome = "uploaded";
  storage.uploaded = [];
  storage.removed = [];
  registered.calls = 0;
});

describe("useMaterialUploads", () => {
  test.each(["failed", "cancelled"] as const)(
    "removes the stored file when the upload %s, since it may have reached Storage",
    async (outcome) => {
      storage.outcome = outcome;
      const { result } = renderUploads();

      act(() => result.current.add([pdf()]));

      await waitFor(() => expect(storage.removed).toEqual(storage.uploaded));
      expect(storage.uploaded).toEqual([
        expect.stringMatching(new RegExp(`^${OWNER}/${COURSE}/`)),
      ]);
      expect(registered.calls).toBe(0);
    },
  );

  test("keeps the file of a registered upload", async () => {
    const { result } = renderUploads();

    act(() => result.current.add([pdf()]));

    await waitFor(() => expect(registered.calls).toBe(1));
    await waitFor(() => expect(result.current.uploads).toEqual([]));
    expect(storage.removed).toEqual([]);
  });
});
