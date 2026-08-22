/**
 * Per-tile top-K density budget. For each tile at each zoom, keep the top K
 * groups by the ranking comparator; the rest get a deeper `minzoom` and
 * reappear on zoom-in — cap and floor at once. Selection is local, so a
 * crowded US tile never buries an unrelated story elsewhere.
 *
 * Two structural invariants: (1) iterate features, not tiles — there are
 * 16.7M tiles at z12 and ~40k features, so tiles exist only as Map keys
 * when occupied; (2) `minzoom` must be monotonic upward (a group assigned
 * at z keeps occupying its tile's budget at every deeper zoom, so nothing
 * at z+1 can evict it) — this is enforced structurally in `assignMinzoom`
 * below, not patched after the fact. Measured binding pattern and full
 * rationale: docs/DESIGN.md#tiles-budget.
 */

import { SPIDERFY_ZOOM, coordKey } from "../lib/spiderfy.ts";
import type { StoryGroup } from "../lib/types.ts";
import { compareGroups } from "./rank.ts";

/** K ~ 12-20, tuned on real data. A phone shows 2-4 tiles, so roughly 30-60 pins. See docs/DESIGN.md#tiles-budget and #open-items (phone profile never measured on real hardware). */
export const DEFAULT_K = 15;

/** Deepest zoom the budget assigns, matching tippecanoe's `-z12`. Data zoom is capped at z10 for usefulness (GDELT gives city centroids), but the budget runs to 12 so a deferred story still gets its last chance to reappear on zoom-in. */
export const MAX_BUDGET_ZOOM = 12;

/**
 * Groups that never win a slot, even at MAX_BUDGET_ZOOM, are assigned
 * MAX_BUDGET_ZOOM + 1 — above tippecanoe's ceiling, not rendered. The
 * country-top floor layer guarantees no country vanishes; `assignMinzoom`
 * returns the overflow count so `run.ts` can report it rather than let it
 * decay quietly. Since spiderfy landed, an overflowed story is still
 * reachable by zooming into its city past SPIDERFY_ZOOM — see
 * docs/DESIGN.md#overflow-as-feature-at-57.
 */
export const NOT_RENDERED = MAX_BUDGET_ZOOM + 1;

/** Web Mercator tile x/y for a coordinate at a zoom. */
export function tileOf(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = (clamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
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
  /** Groups above the tile ceiling, i.e. not rendered anywhere. Reported by run.ts. */
  overflow: number;
};

/**
 * Assign every group a `minzoom`. Returns a new array; inputs are not mutated.
 */
export function assignMinzoom(groups: StoryGroup[], options: BudgetOptions = {}): BudgetResult {
  const k = options.k ?? DEFAULT_K;
  const maxZoom = options.maxZoom ?? MAX_BUDGET_ZOOM;

  // One ranked pass. Selection order is identical in every tile at every zoom,
  // so the comparator runs once rather than once per tile.
  const ranked = [...groups].sort(compareGroups);
  const minzoom = new Map<string, number>();

  for (let zoom = 0; zoom <= maxZoom; zoom++) {
    /** Slots already consumed in a tile by groups assigned at a shallower zoom. */
    const used = new Map<string, number>();
    // Coordinate cap: below SPIDERFY_ZOOM a coordinate holds one story (the
    // best), since GDELT gives every story in a city the same centroid and
    // a second story there would render exactly underneath the first,
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
