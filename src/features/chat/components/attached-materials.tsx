import type { ChatUIMessage } from "@/features/chat/types";
import { MaterialChip, type MaterialListItem } from "@/features/courses";

/**
 * The Materials attached to a sent message, under their current names. A
 * deleted one shows the name it had when attached.
 */
export function AttachedMaterials({
  parts,
  materialsById,
  onOpen,
}: {
  parts: ChatUIMessage["parts"];
  materialsById: Map<string, MaterialListItem>;
  onOpen: (material: MaterialListItem) => void;
}) {
  const references = parts.flatMap((part) =>
    part.type === "data-material" ? [part.data] : [],
  );
  if (references.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {references.map((reference, index) => {
        const material = materialsById.get(reference.materialId);
        return (
          <MaterialChip
            key={`${reference.materialId}-${index}`}
            name={material?.name ?? reference.name}
            mediaType={reference.mediaType}
            deleted={!material}
            onOpen={material && (() => onOpen(material))}
          />
        );
      })}
    </div>
  );
}
