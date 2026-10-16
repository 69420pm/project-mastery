// Public API of the brief feature for any code, client or server. Server-only
// exports live in `server.ts`. It reads the Course's Materials through the
// courses feature, asks and answers the Course's open Findings through the
// knowledge-map feature and records usage through the usage feature, and
// nothing imports it yet except pages.
export { Brief } from "./components/brief";
export { BriefHint } from "./components/brief-hint";
export { BriefLayout } from "./components/brief-layout";
export { BriefLink } from "./components/brief-link";
export { BriefPanel } from "./components/brief-panel";
export { briefPath } from "./domain/brief-paths";
export type { BriefUIMessage, BriefWithMessages, PanelPlan } from "./types";
