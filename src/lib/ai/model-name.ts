/**
 * A model's name for the Student, from its gateway id (`provider/model`):
 * "google/gemini-2.5-flash" is "Gemini 2.5 Flash".
 */
export function modelName(modelId: string): string {
  const model = modelId.slice(modelId.indexOf("/") + 1);
  return model
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
