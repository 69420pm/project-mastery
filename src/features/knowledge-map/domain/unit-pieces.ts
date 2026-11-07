import { createHash } from "node:crypto";
import type { StoredExtraction } from "@/features/knowledge-map/schemas";

/**
 * A unit whose extraction call fails is not given up at once (#248). Its
 * first two attempts call it whole; each later attempt halves its pieces
 * again, by characters between chunks, so the pieces nest. Pieces answered
 * in an earlier attempt are kept (`partialHash`), so only the failed ones
 * are called again. Once a split into single chunks failed twice, the
 * unit is given up: what its pieces gave is kept, and the check report
 * lists it.
 */

/** A piece of a unit: the chunk indexes `[start, end)`. */
export type UnitPiece = { start: number; end: number };

/** The split level of an attempt after `failures` failed ones. */
const levelOf = (failures: number) => Math.max(0, failures - 1);

/**
 * The pieces of a unit whose chunks have these sizes, at a split level:
 * level 0 is the whole unit, and each further level halves every piece of
 * two or more chunks at its middle character.
 */
function piecesAt(sizes: readonly number[], level: number): UnitPiece[] {
  let pieces: UnitPiece[] = [{ start: 0, end: sizes.length }];
  for (let l = 0; l < level; l += 1) {
    pieces = pieces.flatMap((piece) => halve(sizes, piece));
  }
  return pieces;
}

function halve(sizes: readonly number[], piece: UnitPiece): UnitPiece[] {
  if (piece.end - piece.start < 2) return [piece];
  const total = sizes
    .slice(piece.start, piece.end)
    .reduce((sum, size) => sum + size, 0);
  let cut = piece.start + 1;
  let chars = sizes[piece.start]!;
  while (cut < piece.end - 1 && chars + sizes[cut]! / 2 <= total / 2) {
    chars += sizes[cut]!;
    cut += 1;
  }
  return [
    { start: piece.start, end: cut },
    { start: cut, end: piece.end },
  ];
}

/** The pieces of the attempt after `failures` failed attempts. */
export function unitPieces(
  sizes: readonly number[],
  failures: number,
): UnitPiece[] {
  return piecesAt(sizes, levelOf(failures));
}

/**
 * Whether a unit that failed `failures` times is given up: its pieces can
 * be split no further, and that split already failed twice.
 */
export function givenUp(sizes: readonly number[], failures: number): boolean {
  return (
    failures >= 2 &&
    piecesAt(sizes, levelOf(failures)).length ===
      piecesAt(sizes, levelOf(failures - 2)).length
  );
}

/**
 * The `content_hash` of a unit's partial extraction, which holds the
 * pieces answered so far: never the unit's own hash, so the unit stays to
 * be extracted, and found again from it.
 */
export function partialHash(contentHash: string): string {
  return createHash("sha256")
    .update(`partial\u0000${contentHash}`)
    .digest("hex");
}

/**
 * The extractions of a unit's pieces as one: KCs and subtasks in order,
 * Prerequisites and new KCs by index shifted to the joined `kcs`, and the
 * chunks each piece read.
 */
export function joinExtractions(
  parts: readonly StoredExtraction[],
): StoredExtraction {
  const joined: StoredExtraction = {
    kcs: [],
    prerequisites: [],
    readChunkIds: [],
  };
  for (const part of parts) {
    const offset = joined.kcs.length;
    joined.kcs.push(...part.kcs);
    joined.prerequisites.push(
      ...part.prerequisites.map((link) => ({
        from: link.from + offset,
        to: link.to + offset,
      })),
    );
    if (part.exercises) {
      joined.exercises = [
        ...(joined.exercises ?? []),
        ...part.exercises.map((exercise) => ({
          ...exercise,
          newKcs: exercise.newKcs.map((index) => index + offset),
        })),
      ];
    }
    joined.readChunkIds!.push(...(part.readChunkIds ?? []));
  }
  return joined;
}
