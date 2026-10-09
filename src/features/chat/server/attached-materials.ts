import "server-only";
import { convertToModelMessages, type ModelMessage } from "ai";
import type { ChatUIMessage } from "@/features/chat/types";
import {
  getMaterials,
  readMaterialFile,
  type StoredMaterial,
} from "@/features/courses/server";

/**
 * The most bytes of Materials sent to the model in one request: 20 MB,
 * Google's limit for inline request data. Every Material referenced in the
 * history counts, each time it is referenced, because the whole history is
 * sent on every turn (ADR 0007).
 */
export const MAX_MATERIAL_BYTES_PER_REQUEST = 20 * 1024 * 1024;

export const materialsTooLargeMessage =
  "The materials in this chat are too large for the AI together. Start a new chat or attach fewer materials.";

export const materialsUnavailableMessage =
  "Your materials could not be loaded. Please try again.";

export const materialNotFoundMessage = "An attached material does not exist.";

export const materialInOtherCourseMessage =
  "An attached material belongs to another course.";

/** A Material whose file was read for the model. */
export type LoadedMaterial = {
  name: string;
  mediaType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

type MaterialPart = Extract<
  ChatUIMessage["parts"][number],
  { type: "data-material" }
>;

function materialParts(messages: ChatUIMessage[]): MaterialPart[] {
  return messages.flatMap((message) =>
    message.role === "user"
      ? message.parts.filter(
          (part): part is MaterialPart => part.type === "data-material",
        )
      : [],
  );
}

/**
 * Why a new Student message may not attach its Materials, or null when it
 * may: each must be the Student's own and in the Chat's Course.
 */
export async function attachmentRefusal(
  message: ChatUIMessage,
  courseId: string,
): Promise<string | null> {
  const ids = [
    ...new Set(materialParts([message]).map((part) => part.data.materialId)),
  ];
  if (ids.length === 0) return null;
  const materials = await getMaterials(ids);
  if (materials.some((material) => material.courseId !== courseId)) {
    return materialInOtherCourseMessage;
  }
  return materials.length < ids.length ? materialNotFoundMessage : null;
}

/**
 * Reads the files of every Material the history references, by id. Deleted
 * Materials are left out. Refuses with "too large" when the files sent would
 * exceed `MAX_MATERIAL_BYTES_PER_REQUEST`, before reading any, and with
 * "failed" when Storage fails.
 */
export async function loadAttachedMaterials(
  history: ChatUIMessage[],
): Promise<Map<string, LoadedMaterial> | "too large" | "failed"> {
  const parts = materialParts(history);
  if (parts.length === 0) return new Map();
  const materials = new Map(
    (
      await getMaterials([
        ...new Set(parts.map((part) => part.data.materialId)),
      ])
    ).map((material) => [material.id, material]),
  );

  const totalBytes = parts.reduce(
    (total, part) =>
      total + (materials.get(part.data.materialId)?.sizeBytes ?? 0),
    0,
  );
  if (totalBytes > MAX_MATERIAL_BYTES_PER_REQUEST) return "too large";

  const loaded = new Map<string, LoadedMaterial>();
  const results = await Promise.all(
    [...materials.values()].map(
      async (material) => [material, await readMaterialFile(material)] as const,
    ),
  );
  for (const [material, bytes] of results) {
    if (bytes === "failed") return "failed";
    // The file went with its Material after it was looked up.
    if (bytes === "missing") continue;
    loaded.set(material.id, toLoaded(material, bytes));
  }
  return loaded;
}

function toLoaded(material: StoredMaterial, bytes: Uint8Array): LoadedMaterial {
  return {
    name: material.name,
    mediaType: material.mediaType,
    sizeBytes: material.sizeBytes,
    bytes,
  };
}

/**
 * The model messages for a history: each attached Material becomes a file
 * with its current name, and a deleted one a note that it was deleted.
 */
export function toModelMessages(
  history: ChatUIMessage[],
  materials: Map<string, LoadedMaterial>,
): Promise<ModelMessage[]> {
  return convertToModelMessages<ChatUIMessage>(history, {
    convertDataPart: (part) => {
      if (part.type !== "data-material") return undefined;
      const material = materials.get(part.data.materialId);
      return material
        ? {
            type: "file",
            data: material.bytes,
            mediaType: material.mediaType,
            filename: material.name,
          }
        : {
            type: "text",
            text: `[The attached file "${part.data.name}" was deleted.]`,
          };
    },
  });
}

/** The Materials sent with a history, once per reference. */
export function sentMaterials(
  history: ChatUIMessage[],
  materials: Map<string, LoadedMaterial>,
): LoadedMaterial[] {
  return materialParts(history).flatMap((part) => {
    const material = materials.get(part.data.materialId);
    return material ? [material] : [];
  });
}
