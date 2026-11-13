/** A tool call in a streamed reply, with its result or failure. */
export type StreamedCall = {
  toolName: string;
  input: Record<string, unknown>;
  /** The tool's result, once it returned one. */
  output?: unknown;
  /** The refusal or failure, when the call failed. */
  error?: string;
};

/**
 * Reads the body of an AI SDK UI message stream, as the Brief and Chat
 * handlers return it: the reply's text, each step's text apart, its tool
 * calls in order, and the errors the stream reported.
 */
export function readUIStream(body: string): {
  text: string;
  calls: StreamedCall[];
  errors: string[];
} {
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  const calls: StreamedCall[] = [];
  const byId = new Map<string, StreamedCall>();
  const errors: string[] = [];
  let text = "";
  for (const chunk of chunks) {
    if (chunk.type === "text-start") text += "\n\n";
    if (chunk.type === "text-delta") text += chunk.delta;
    if (chunk.type === "tool-input-available") {
      const call = { toolName: chunk.toolName, input: chunk.input ?? {} };
      calls.push(call);
      byId.set(chunk.toolCallId, call);
    }
    const call = byId.get(chunk.toolCallId);
    if (call && chunk.type === "tool-output-available") {
      call.output = chunk.output;
    }
    if (call && chunk.type === "tool-output-error") {
      call.error = String(chunk.errorText);
    }
    if (chunk.type === "error") errors.push(String(chunk.errorText));
  }
  return { text: text.trim(), calls, errors };
}
