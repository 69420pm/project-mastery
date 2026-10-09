const typeLabels: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
};

/** A Material's type as the Student knows it, such as "PDF". */
export function materialTypeLabel(mediaType: string): string {
  return typeLabels[mediaType] ?? mediaType;
}

/** A file size in the largest fitting unit, such as "1.2 MB" or "340 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
