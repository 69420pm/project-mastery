"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_ATTACHED_MATERIALS,
  tooManyMaterialsMessage,
} from "@/features/chat/schemas";
import {
  useMaterialUploads,
  type MaterialListItem,
  type MaterialReference,
} from "@/features/courses";

/**
 * The Materials of the message being written: the ones chosen from the
 * Course, and the files uploaded from the message box, picked, pasted or
 * dropped, within the limit of a message.
 */
export function useMessageAttachments({
  ownerId,
  courseId,
  courseMaterials,
  limitReached,
  onInputError,
}: {
  /** The signed-in Student, whose Storage folder uploads go to. */
  ownerId: string;
  courseId: string;
  /** The Course's Materials. */
  courseMaterials: MaterialListItem[];
  /** Whether the Daily limit is reached, which refuses pasted and dropped files. */
  limitReached: boolean;
  /** Reports why files were not taken, or null to clear the message. */
  onInputError: (message: string | null) => void;
}) {
  const [attached, setAttached] = useState<MaterialReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Materials uploaded from this message box since the page loaded. */
  const [uploaded, setUploaded] = useState<MaterialListItem[]>([]);
  const materials = [...uploaded, ...courseMaterials];
  const materialsById = new Map(materials.map((m) => [m.id, m]));
  const fileInput = useRef<HTMLInputElement>(null);
  const dropZone = useRef<HTMLDivElement>(null);
  const { uploads, add, retry, remove } = useMaterialUploads({
    ownerId,
    courseId,
    // A refresh would replace a new Chat and the message in it.
    refresh: "on-leave",
    onRegistered: (material) => {
      setUploaded((current) => [
        {
          id: material.materialId,
          name: material.name,
          mediaType: material.mediaType,
          sizeBytes: 0,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      setAttached((current) => [...current, material]);
    },
  });

  /** Uploads picked, pasted or dropped files, within the message's limit. */
  function uploadFiles(files: Iterable<File>) {
    const picked = [...files];
    const room = Math.max(
      MAX_ATTACHED_MATERIALS - attached.length - uploads.length,
      0,
    );
    onInputError(picked.length > room ? tooManyMaterialsMessage : null);
    add(picked.slice(0, room));
  }

  // Files pasted or dropped on the message box are uploaded like the ones
  // "Upload file" picks, not left to the prompt input's own attachments.
  const uploadFilesRef = useRef(uploadFiles);
  useEffect(() => {
    uploadFilesRef.current = uploadFiles;
  });
  const onInputErrorRef = useRef(onInputError);
  useEffect(() => {
    onInputErrorRef.current = onInputError;
  });
  useEffect(() => {
    const zone = dropZone.current;
    if (!zone) return;
    const takeFiles = (event: Event, files: File[]) => {
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (limitReached) {
        onInputErrorRef.current(
          "You have reached today's limit. Try again tomorrow.",
        );
      } else {
        uploadFilesRef.current(files);
      }
    };
    const onPaste = (event: ClipboardEvent) =>
      takeFiles(
        event,
        [...(event.clipboardData?.items ?? [])].flatMap((item) => {
          const file = item.kind === "file" ? item.getAsFile() : null;
          return file ? [file] : [];
        }),
      );
    const onDrop = (event: DragEvent) =>
      takeFiles(event, [...(event.dataTransfer?.files ?? [])]);
    // Capture, to run before the prompt input's own handlers.
    zone.addEventListener("paste", onPaste, true);
    zone.addEventListener("drop", onDrop, true);
    return () => {
      zone.removeEventListener("paste", onPaste, true);
      zone.removeEventListener("drop", onDrop, true);
    };
  }, [limitReached]);

  function toggleAttached(material: MaterialListItem) {
    setAttached((current) =>
      current.some(({ materialId }) => materialId === material.id)
        ? current.filter(({ materialId }) => materialId !== material.id)
        : [
            ...current,
            {
              materialId: material.id,
              name: material.name,
              mediaType: material.mediaType as MaterialReference["mediaType"],
            },
          ],
    );
  }

  function detach(materialId: string) {
    setAttached((current) =>
      current.filter((material) => material.materialId !== materialId),
    );
  }

  return {
    /** The Materials attached to the message. */
    attached,
    /** Clears the attachments, once the message is sent. */
    clearAttached: () => setAttached([]),
    toggleAttached,
    detach,
    /** The Course's Materials and the ones uploaded from the message box. */
    materials,
    materialsById,
    pickerOpen,
    setPickerOpen,
    /** Ref for the hidden file input that "Upload file" opens. */
    fileInput,
    /** Ref for the element whose pasted and dropped files are uploaded. */
    dropZone,
    uploadFiles,
    uploads,
    /** Whether an upload is unfinished, failed ones included. */
    uploading: uploads.length > 0,
    retryUpload: retry,
    removeUpload: remove,
  };
}
