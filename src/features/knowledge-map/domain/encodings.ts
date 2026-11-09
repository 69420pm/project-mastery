import type {
  MapPriorities,
  MapRecallBand,
} from "@/features/knowledge-map/types";
import { DEFAULT_LAYERS, type MapLayers } from "./map-graph";

/**
 * How the Knowledge map graph encodes data on its KC nodes (#118): colour
 * by one attribute, size by Priority, and the saved settings. Pure code.
 */

export const COLOR_BYS = ["band", "priority"] as const;
export type ColorBy = (typeof COLOR_BYS)[number];

export const COLOR_BY_NAMES: Record<ColorBy, string> = {
  band: "Recall band",
  priority: "Priority",
};

/** What the Student can change in the graph and the page remembers. */
export type MapSettings = {
  layers: MapLayers;
  colorBy: ColorBy;
  sizeByPriority: boolean;
};

export const DEFAULT_SETTINGS: MapSettings = {
  layers: DEFAULT_LAYERS,
  colorBy: "band",
  sizeByPriority: false,
};

const NEUTRAL = "var(--muted-foreground)";

const BAND_COLORS: Record<MapRecallBand, string> = {
  new: NEUTRAL,
  weak: "var(--destructive)",
  fading: "var(--warning)",
  strong: "var(--success)",
};

/** Lowest to highest Priority; the theme's chart ramp, light to dark. */
const PRIORITY_RAMP = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** The smallest a KC node's visual gets when sized by Priority. */
const MIN_SIZE_SCALE = 0.7;

/**
 * Where each KC with a Priority falls from 0 (lowest value) to 1 (highest),
 * by KC id. Excluded KCs and KCs without a Priority are left out.
 */
export function priorityFractions(
  priorities: MapPriorities["kcs"],
): Map<string, number> {
  const ranked = Object.entries(priorities).filter(
    ([, p]) => p.level !== "excluded",
  );
  const values = ranked.map(([, p]) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  return new Map(
    ranked.map(([id, p]) => [id, span === 0 ? 1 : (p.value - min) / span]),
  );
}

/**
 * The factor a KC node's visual is scaled by when sized by Priority: from
 * `MIN_SIZE_SCALE` for the lowest up to 1 for the highest. A KC without a
 * Priority gets the minimum. The node's layout box never changes.
 */
export function sizeScale(fraction: number | undefined): number {
  return MIN_SIZE_SCALE + (1 - MIN_SIZE_SCALE) * (fraction ?? 0);
}

/** The ramp colour for a fraction from `priorityFractions`. */
function rampColor(fraction: number): string {
  const step = Math.min(
    PRIORITY_RAMP.length - 1,
    Math.floor(fraction * PRIORITY_RAMP.length),
  );
  return PRIORITY_RAMP[step]!;
}

/** What `kcColor` needs to colour one KC. */
export type ColorContext = {
  band: MapRecallBand;
  /** From `priorityFractions`; undefined without a Priority. */
  fraction: number | undefined;
};

export function kcColor(colorBy: ColorBy, kc: ColorContext): string {
  switch (colorBy) {
    case "band":
      return BAND_COLORS[kc.band];
    case "priority":
      return kc.fraction === undefined ? NEUTRAL : rampColor(kc.fraction);
  }
}

export type LegendEntry = { label: string; color: string };

/** The legend for `colorBy`: one entry per colour the graph can show. */
export function legendEntries(
  colorBy: ColorBy,
  bandNames: Record<MapRecallBand, string>,
): LegendEntry[] {
  switch (colorBy) {
    case "band":
      return (Object.keys(BAND_COLORS) as MapRecallBand[]).map((band) => ({
        label: bandNames[band],
        color: BAND_COLORS[band],
      }));
    case "priority":
      return [
        { label: "Lowest", color: PRIORITY_RAMP[0]! },
        { label: "Middle", color: PRIORITY_RAMP[2]! },
        { label: "Highest", color: PRIORITY_RAMP[4]! },
        { label: "Excluded or none", color: NEUTRAL },
      ];
  }
}

/**
 * The settings in a saved string, with the defaults for anything missing or
 * invalid: a stored value from an older version, a broken one, or none.
 */
export function parseSettings(saved: string | null): MapSettings {
  let data: unknown;
  try {
    data = saved === null ? null : JSON.parse(saved);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof data !== "object" || data === null) return DEFAULT_SETTINGS;
  const stored = data as Record<string, unknown>;
  const storedLayers =
    typeof stored.layers === "object" && stored.layers !== null
      ? (stored.layers as Record<string, unknown>)
      : {};
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  const layers: MapLayers = {
    exercises: flag(storedLayers.exercises, DEFAULT_LAYERS.exercises),
    prerequisites: flag(
      storedLayers.prerequisites,
      DEFAULT_LAYERS.prerequisites,
    ),
  };
  return {
    layers,
    colorBy: COLOR_BYS.find((c) => c === stored.colorBy) ?? "band",
    sizeByPriority: flag(stored.sizeByPriority, false),
  };
}
