import { fstatSync, readSync } from "node:fs";

/**
 * Reads an open file from `offset` to its current end. Working on one file
 * descriptor, instead of checking a path and opening it again, means the
 * size and the content always come from the same file.
 */
export function readFrom(fd: number, offset = 0) {
  const { size } = fstatSync(fd);
  const start = Math.min(offset, size);
  const buffer = Buffer.alloc(size - start);
  readSync(fd, buffer, 0, buffer.length, start);
  return { text: buffer.toString("utf8"), size };
}
