/** Throws a query's error as "`action` failed: message". */
export function failed(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}
