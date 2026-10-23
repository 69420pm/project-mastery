import { chatEval } from "./chat";
import type { EvalDefinition } from "./eval";

// Register each eval here; its fixture is `evals/datasets/<name>.json`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
export const EVALS: EvalDefinition<any, any>[] = [chatEval];
