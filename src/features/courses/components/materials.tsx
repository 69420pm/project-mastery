"use client";

import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCwIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CourseNameDialog } from "@/features/courses/components/course-name-dialog";
import { DeleteMaterialDialog } from "@/features/courses/components/delete-material-dialog";
import { MaterialViewer } from "@/features/courses/components/material-viewer";
import {
  formatFileSize,
  materialTypeLabel,
} from "@/features/courses/domain/material-format";
import {
  type MaterialUpload,
  useMaterialUploads,
} from "@/features/courses/hooks/use-material-uploads";
import {
  MATERIAL_MEDIA_TYPES,
  MAX_MATERIAL_NAME_LENGTH,
} from "@/features/courses/schemas";
import { renameMaterial } from "@/features/courses/server/actions";
import type { MaterialListItem } from "@/features/courses/types";
import { cn } from "@/lib/utils";

type MaterialsProps = {
  /** The signed-in Student, whose Storage folder uploads go to. */
  ownerId: string;
  courseId: string;
  /** The Course's Materials, newest first. */
  materials: MaterialListItem[];
};

/**
 * A Course's Materials page: uploading PDFs and images by picking or
 * dropping them, with progress, and the Materials, newest first, to open,
 * rename or delete.
 */
export function Materials({ ownerId, courseId, materials }: MaterialsProps) {
  const { uploads, add, retry, remove } = useMaterialUploads({
    ownerId,
    courseId,
  });
  const [opened, setOpened] = useState<MaterialListItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-6",
        dragging && "rounded-xl bg-muted/50 ring-2 ring-primary ring-inset",
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Materials</h1>
        <Button onClick={() => input.current?.click()}>
          <UploadIcon data-icon="inline-start" />
          Upload files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={MATERIAL_MEDIA_TYPES.join(",")}
          // Opened by the button above.
          hidden
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul aria-label="Uploads" className="flex flex-col gap-2">
          {uploads.map((upload) => (
            <UploadEntry
              key={upload.key}
              upload={upload}
              onRetry={() => retry(upload.key)}
              onRemove={() => remove(upload.key)}
            />
          ))}
        </ul>
      )}

      {materials.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <UploadIcon className="size-8 text-muted-foreground" />
          <h2 className="text-lg font-medium">No materials yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Drop slides, scripts, exercise sheets or old exams here, as PDFs or
            images up to 20 MB each.
          </p>
        </div>
      ) : (
        <ul
          aria-label="Materials"
          className="flex flex-col divide-y rounded-xl border"
        >
          {materials.map((material) => (
            <MaterialEntry
              key={material.id}
              material={material}
              onOpen={() => setOpened(material)}
            />
          ))}
        </ul>
      )}

      <MaterialViewer material={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

/** A file while it uploads, or why it did not. */
function UploadEntry({
  upload,
  onRetry,
  onRemove,
}: {
  upload: MaterialUpload;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const percent = Math.round(upload.progress * 100);

  return (
    <li
      aria-label={upload.filename}
      className="flex items-center gap-3 rounded-xl border px-4 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-medium">{upload.filename}</span>
        {upload.status === "failed" ? (
          <p role="alert" className="text-sm text-destructive">
            {upload.message}
          </p>
        ) : (
          <div
            role="progressbar"
            aria-label={`Uploading ${upload.filename}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      {upload.status === "failed" && upload.canRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCwIcon data-icon="inline-start" />
          Retry
        </Button>
      )}
      {upload.status !== "registering" && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={upload.status === "failed" ? "Dismiss" : "Cancel upload"}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function MaterialIcon({ mediaType }: { mediaType: string }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (mediaType === "application/pdf")
    return <FileTextIcon className={className} />;
  if (mediaType.startsWith("image/"))
    return <ImageIcon className={className} />;
  return <FileIcon className={className} />;
}

/** One Material, opening in the viewer, with its "…" menu. */
function MaterialEntry({
  material,
  onOpen,
}: {
  material: MaterialListItem;
  onOpen: () => void;
}) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);

  return (
    <li className="flex items-center gap-3 py-2 pr-2 pl-4">
      <MaterialIcon mediaType={material.mediaType} />
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={onOpen}
          className="truncate rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {material.name}
        </button>
        <span className="text-sm text-muted-foreground">
          {materialTypeLabel(material.mediaType)} ·{" "}
          {formatFileSize(material.sizeBytes)} ·{" "}
          {/* Formatted in the viewer's time zone, which the server lacks. */}
          <time dateTime={material.createdAt} suppressHydrationWarning>
            {dateFormat.format(new Date(material.createdAt))}
          </time>
        </span>
      </div>
      {/* Not modal, so focus moves cleanly into a dialog opened from it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Material actions">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("delete")}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CourseNameDialog
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        title="Rename material"
        submitLabel="Save"
        initialName={material.name}
        maxLength={MAX_MATERIAL_NAME_LENGTH}
        placeholder="Lecture 3"
        onSave={(name) => renameMaterial({ materialId: material.id, name })}
      />
      <DeleteMaterialDialog
        material={material}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
      />
    </li>
  );
}
