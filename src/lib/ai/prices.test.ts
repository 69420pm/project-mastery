// @vitest-environment node
import { expect, test, vi } from "vitest";
import { AI_TASKS, type TaskConfig } from "./models";
import { MODEL_PRICES } from "./prices";

vi.mock("server-only", () => ({}));

// Every model a call can reach: defaults, gateway fallbacks and calibration
// candidates.
const configuredModels = new Set(
  Object.values<TaskConfig>(AI_TASKS).flatMap((config) => [
    config.model,
    ...config.fallbacks,
    ...(config.candidates ?? []),
  ]),
);

test.each([...configuredModels])("%s has a price", (id) => {
  expect(MODEL_PRICES).toHaveProperty([id]);
});
