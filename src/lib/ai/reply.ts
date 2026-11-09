import {
  APICallError,
  InvalidToolInputError,
  NoSuchToolError,
  RetryError,
} from "ai";

/**
 * Pieces every streamed reply shares, in a Chat and in the Brief: the text of
 * a message and the error the Student sees when a reply fails.
 */

/** The text of a message's parts, joined, without any non-text parts. */
export function messageText(
  parts: readonly { type: string; text?: unknown }[],
): string {
  return parts
    .map((part) =>
      part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

/**
 * The HTTP status of a failed model call, read from the `APICallError`
 * inside a `RetryError` when the call was retried.
 */
function statusCode(error: unknown): number | undefined {
  if (RetryError.isInstance(error)) return statusCode(error.lastError);
  if (APICallError.isInstance(error)) return error.statusCode;
  return undefined;
}

/** A tool call the model got wrong, as the AI SDK names it in a string. */
const TOOL_CALL_ERROR = /^AI_(InvalidToolInputError|NoSuchToolError): /;

/**
 * The error the Student sees when a reply fails mid-stream. A tool call the
 * model got wrong keeps its own message: it is stored as the tool's error and
 * tells the model what to fix on the next step and the next turn.
 */
export function replyErrorMessage(error: unknown): string {
  if (InvalidToolInputError.isInstance(error)) return error.message;
  if (NoSuchToolError.isInstance(error)) return error.message;
  // The AI SDK hands an invalid call's error to `onError` a second time as a
  // string, for the call's own part (`tool-error` from `streamText`).
  if (typeof error === "string" && TOOL_CALL_ERROR.test(error)) return error;
  return statusCode(error) === 429
    ? "The AI is busy right now. Please try again in a moment."
    : "The AI could not reply. Please try again.";
}
