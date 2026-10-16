/** The anchor of a chunk in its Material's chunk view, without the `#`. */
export function chunkAnchor(chunkId: string): string {
  return `chunk-${chunkId}`;
}
