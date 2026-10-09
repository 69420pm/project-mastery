"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { materialNameFromFilename } from "@/features/courses/domain/material-name";
import {
  MATERIALS_BUCKET,
  materialStoragePath,
} from "@/features/courses/domain/material-storage";
import {
  materialFileSchema,
  type MaterialReference,
} from "@/features/courses/schemas";
import {
  invalidatePages,
  registerMaterial,
} from "@/features/courses/server/actions";
import { removeUploadedFile, uploadFile } from "@/lib/supabase/upload";

/** One file the Student added, while it uploads or when it did not work. */
export type MaterialUpload = {
  key: string;
  filename: string;
  mediaType: string;
  status: "uploading" | "registering" | "failed";
  /** Share of the bytes sent, from 0 to 1. */
  progress: number;
  /** Why it failed. */
  message?: string;
  /** Whether trying again can help: false for a refused file. */
  canRetry: boolean;
};

const uploadFailed = "The upload failed. Please try again.";

/**
 * Uploads files as Materials of a Course: each file is checked, uploaded
 * straight to Storage with progress under a new Material id, then
 * registered. A finished upload leaves the list, since the Materials list
 * shows it; a failed one stays with its message until retried or dismissed.
 * A retry uses a new id.
 */
export function useMaterialUploads({
  ownerId,
  courseId,
  onRegistered,
  refreshPage = true,
}: {
  ownerId: string;
  courseId: string;
  /** Called once for each upload that became a Material. */
  onRegistered?: (material: MaterialReference) => void;
  /**
   * Whether registering refreshes the page. False where a refresh would
   * lose what the Student is writing.
   */
  refreshPage?: boolean;
}) {
  const [uploads, setUploads] = useState<MaterialUpload[]>([]);
  const registeredCallback = useRef(onRegistered);
  useEffect(() => {
    registeredCallback.current = onRegistered;
  });
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());

  const update = useCallback(
    (key: string, change: Partial<MaterialUpload>) =>
      setUploads((current) =>
        current.map((upload) =>
          upload.key === key ? { ...upload, ...change } : upload,
        ),
      ),
    [],
  );

  const forget = useCallback((key: string) => {
    files.current.delete(key);
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setUploads((current) => current.filter((upload) => upload.key !== key));
  }, []);

  // Leaving the page cancels unfinished uploads. Registering did not refresh
  // the page, so leaving after one drops the router's cached pages: Back then
  // shows the new Material, on the Materials page and in the Chat.
  const unrefreshed = useRef({ registered: false });
  useEffect(() => {
    const running = controllers.current;
    const state = unrefreshed.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      if (state.registered) void invalidatePages();
    };
  }, []);

  const run = useCallback(
    async (key: string, file: File) => {
      const check = materialFileSchema.safeParse({
        mediaType: file.type,
        sizeBytes: file.size,
      });
      if (!check.success) {
        update(key, {
          status: "failed",
          message: check.error.issues[0]?.message,
          canRetry: false,
        });
        return;
      }

      const materialId = crypto.randomUUID();
      const path = materialStoragePath(ownerId, courseId, materialId);
      const controller = new AbortController();
      controllers.current.set(key, controller);
      update(key, {
        status: "uploading",
        progress: 0,
        message: undefined,
        canRetry: true,
      });

      const outcome = await uploadFile({
        bucket: MATERIALS_BUCKET,
        path,
        file,
        signal: controller.signal,
        onProgress: (progress) => update(key, { progress }),
      });
      if (outcome !== "uploaded") {
        // Storage may have stored the file before the response was lost or
        // the Student cancelled, so remove it; a missing file is harmless.
        await removeUploadedFile(MATERIALS_BUCKET, path);
        if (outcome === "cancelled") return;
        controllers.current.delete(key);
        update(key, { status: "failed", message: uploadFailed });
        return;
      }

      update(key, { status: "registering", progress: 1 });
      let result: Awaited<ReturnType<typeof registerMaterial>>;
      try {
        result = await registerMaterial({
          materialId,
          courseId,
          name: materialNameFromFilename(file.name),
          mediaType: file.type,
          sizeBytes: file.size,
          refresh: refreshPage,
        });
      } catch (error) {
        // The action was never reached, so the file is removed here.
        console.error("Registering a Material failed", error);
        await removeUploadedFile(MATERIALS_BUCKET, path);
        result = { ok: false, message: uploadFailed };
      }
      controllers.current.delete(key);
      if (result.ok) {
        if (!refreshPage) unrefreshed.current.registered = true;
        registeredCallback.current?.({
          materialId,
          name: materialNameFromFilename(file.name),
          mediaType: file.type as MaterialReference["mediaType"],
        });
        forget(key);
        return;
      }
      const fieldError = Object.values(result.fieldErrors ?? {})[0]?.[0];
      update(key, { status: "failed", message: fieldError ?? result.message });
    },
    [courseId, ownerId, refreshPage, update, forget],
  );

  /** Starts uploading the files the Student picked or dropped. */
  const add = useCallback(
    (picked: Iterable<File>) => {
      const added = [...picked].map((file) => {
        const key = crypto.randomUUID();
        files.current.set(key, file);
        return { key, file };
      });
      setUploads((current) => [
        ...current,
        ...added.map(({ key, file }) => ({
          key,
          filename: file.name,
          mediaType: file.type,
          status: "uploading" as const,
          progress: 0,
          canRetry: true,
        })),
      ]);
      for (const { key, file } of added) void run(key, file);
    },
    [run],
  );

  /** Uploads a failed file again, under a new Material id. */
  const retry = useCallback(
    (key: string) => {
      const file = files.current.get(key);
      if (file) void run(key, file);
    },
    [run],
  );

  return {
    uploads,
    add,
    retry,
    /** Cancels an upload, or dismisses a failed one. */
    remove: forget,
  };
}
