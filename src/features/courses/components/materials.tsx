"use client";

import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  RotateCwIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CourseNameDialog } from "@/features/courses/components/course-name-dialog";
import { DeleteMaterialDialog } from "@/features/courses/components/delete-material-dialog";
import { MaterialViewer } from "@/features/courses/components/material-viewer";
import { materialChunksPath } from "@/features/courses/domain/course-paths";
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
import {
  canStartParse,
  isParseRunning,
  parseStateLabel,
  type ParseState,
  startMaterialParse,
} from "@/features/ingestion";
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
  useParsePolling(materials);
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
              courseId={courseId}
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

/** A Material's parse state, linking to its chunks once parsed. */
function ParseStateLine({
  courseId,
  material,
}: {
  courseId: string;
  material: MaterialListItem;
}) {
  const { parse } = material;
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-sm">
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          parse.status === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {isParseRunning(parse) && <Spinner className="size-3" />}
        {parseStateLabel(parse)}
        {parse.status === "failed" && parse.failure && `: ${parse.failure}`}
      </span>
      {canStartParse(parse) && (
        <ParseButton materialId={material.id} status={parse.status} />
      )}
      {parse.status === "parsed" && (
        <Link
          href={materialChunksPath(courseId, material.id)}
          className="font-medium underline-offset-4 hover:underline"
        >
          View chunks
        </Link>
      )}
    </span>
  );
}

/**
 * Starts a Material's parse: Retry after a failed one, Parse for one never
 * parsed or never started. A retry resumes where the last parse stopped.
 */
function ParseButton({
  materialId,
  status,
}: {
  materialId: string;
  status: ParseState["status"];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const label = status === "failed" ? "Retry" : "Parse";

  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startMaterialParse({ materialId });
            if (!result.ok) setError(result.message);
            router.refresh();
          })
        }
      >
        {isPending && <Spinner className="size-3" />}
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

/** How often the page refreshes while a parse runs. */
const PARSE_POLL_MS = 2000;

/**
 * Refreshes the page's data while any Material waits or parses, so its
 * state moves on without a reload.
 */
function useParsePolling(materials: MaterialListItem[]) {
  const router = useRouter();
  const running = materials.some((material) => isParseRunning(material.parse));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), PARSE_POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);
}

/** One Material, opening in the viewer, with its "…" menu. */
function MaterialEntry({
  courseId,
  material,
  onOpen,
}: {
  courseId: string;
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
        <ParseStateLine courseId={courseId} material={material} />
      </div>
      <RowActionsMenu
        label="Material actions"
        onRename={() => setDialog("rename")}
        onDelete={() => setDialog("delete")}
      />
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
