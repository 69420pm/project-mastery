/**
 * The description of a new Chat's empty state (#103), from code: what the
 * Student can expect the AI to open with.
 */
export function openingLine(hasMap: boolean, dueCount: number): string {
  if (!hasMap) {
    return "Build your Knowledge map to start studying, or ask about anything.";
  }
  if (dueCount === 0) {
    return "Nothing due: let's learn something new. Or ask about anything.";
  }
  return `${dueCount} ${dueCount === 1 ? "review" : "reviews"} due, then something new. Or ask about anything.`;
}
