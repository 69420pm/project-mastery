import { z } from "zod";

/**
 * An id the call was offered: the JSON schema lists them as an enum, which
 * guides the model and the mock provider, but any string validates, so an
 * unknown id reaches the code checks that drop it instead of failing the
 * call (#225).
 */
export function offeredId(ids: readonly string[]) {
  return ids.length > 0 ? z.string().meta({ enum: [...ids] }) : z.string();
}
