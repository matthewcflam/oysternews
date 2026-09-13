import { coordKey, SPIDERFY_ZOOM } from "../src/lib/spiderfy.ts";
import type { StoryGroup } from "../src/lib/types.ts";
import { compareGroups } from "./rank.ts";

export const DEFAULT_K = 15;

export const MAX_BUDGET_ZOOM = 12;

export const NOT_RENDERED = MAX_BUDGET_ZOOM + 1;

export function tileOf(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = (clamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale
  );
  // A point exactly on the antimeridian or pole lands one tile past the edge.
  return { x: Math.min(Math.max(x, 0), scale - 1), y: Math.min(Math.max(y, 0), scale - 1) };
}

const tileKey = (x: number, y: number): string => `${x}/${y}`;

export type BudgetOptions = {
  k?: number;
  maxZoom?: number;
};

export type BudgetResult = {
  groups: StoryGroup[];
  overflow: number;
};

export function assignMinzoom(groups: StoryGroup[], options: BudgetOptions = {}): BudgetResult {
  const k = options.k ?? DEFAULT_K;
  const maxZoom = options.maxZoom ?? MAX_BUDGET_ZOOM;

  const ranked = [...groups].sort(compareGroups);
  const minzoom = new Map<string, number>();

  for (let zoom = 0; zoom <= maxZoom; zoom++) {
    const used = new Map<string, number>();
    // Coordinate cap: below SPIDERFY_ZOOM one story per coord (GDELT centroid collision).
    // invisible, wasting a budget slot. Lifts at SPIDERFY_ZOOM, where the
    // client can spread the stack into legs and leaves. See lib/spiderfy.ts.
    const occupied = new Set<string>();
    const capped = zoom < SPIDERFY_ZOOM;

    // Pass 1: an already-assigned group still occupies its tile here. This is
    // what makes minzoom monotonic — deeper zooms inherit their ancestors'
    // occupants and cannot evict them.
    for (const group of ranked) {
      const assigned = minzoom.get(group.id);
      if (assigned === undefined) continue;
      const { x, y } = tileOf(group.lat, group.lon, zoom);
      const key = tileKey(x, y);
      used.set(key, (used.get(key) ?? 0) + 1);
      if (capped) occupied.add(coordKey(group.lon, group.lat));
    }

    // Pass 2: fill what is left, best first.
    for (const group of ranked) {
      if (minzoom.has(group.id)) continue;
      const coordinate = coordKey(group.lon, group.lat);
      // Deferred, not dropped: it becomes eligible again at SPIDERFY_ZOOM, and
      // because assignment is permanent the deferral cannot break monotonicity.
      if (capped && occupied.has(coordinate)) continue;
      const { x, y } = tileOf(group.lat, group.lon, zoom);
      const key = tileKey(x, y);
      const count = used.get(key) ?? 0;
      if (count >= k) continue;
      used.set(key, count + 1);
      if (capped) occupied.add(coordinate);
      minzoom.set(group.id, zoom);
    }
  }

  const overflowZoom = maxZoom + 1;
  let overflow = 0;
  const assigned = groups.map((group) => {
    const zoom = minzoom.get(group.id);
    if (zoom === undefined) overflow++;
    return { ...group, minzoom: zoom ?? overflowZoom };
  });

  return { groups: assigned, overflow };
}

// The country-top floor: top 1 per country, EXEMPT from the tile budget,
// minzoom 0. At z0 the whole planet is one tile, so the budget alone would
// put only 12-20 stories on the entire world map; this keeps every country
// with news represented regardless of salience. Ranks on the same
// comparator, so a country's lowest-salience-but-only tier-1 story is still
// its representative — intended, not a side effect.
export function countryTopGroups(groups: StoryGroup[]): StoryGroup[] {
  const best = new Map<string, StoryGroup>();

  for (const group of groups) {
    if (!group.countryCode) continue;
    const current = best.get(group.countryCode);
    if (!current || compareGroups(group, current) < 0) best.set(group.countryCode, group);
  }

  return [...best.values()].map((group) => ({ ...group, minzoom: 0 }));
}
