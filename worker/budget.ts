/**
 * Per-tile top-K density budget. PURE (HANDOFF.md §3.3, §2.4).
 *
 * For each tile at each zoom, keep the top K groups inside it by the §2.5
 * comparator; the rest get a deeper `minzoom` and reappear on zoom-in.
 *
 * This is the cap AND the floor. A sparse tile keeps everything it has, so the
 * map is never empty; a crowded tile defers its weakest, so it never turns to
 * mush. Because selection is local, US stories compete only with other US
 * stories — the Strait of Hormuz is never buried by an American election.
 *
 * Two traps, both named in §5 as bugs already paid for:
 *
 * 1. **Iterate features, not tiles.** There are 16.7M tiles at z12 and ~40k
 *    features. Walking the tile space is not slow, it is impossible. Every loop
 *    here is over features, with tiles as Map keys that only exist when occupied.
 *
 * 2. **`minzoom` must be monotonic upward** — "a feature can win its z5 tile and
 *    lose its z6 tile". The fix is structural rather than a post-hoc repair: a
 *    group assigned at z KEEPS OCCUPYING ITS TILE'S BUDGET at every deeper zoom,
 *    and each zoom only fills the slots left over. A group can therefore never
 *    be selected at z and missing at z+1, because nothing at z+1 can evict it.
 *
 * Measured (§2.4, FINDINGS §12): the budget binds in four countries and is a
 * no-op in ninety. Of 124 countries with news in a 24-hour window, four clear
 * 1,000 stories/day (US 11,800, India 4,900, UK 2,700, Canada 1,750), 67 sit
 * between 10 and 99, and 28 get fewer than ten. Tune K against the US and India;
 * everywhere else the floor is what does the work.
 */

import { SPIDERFY_ZOOM, coordKey } from "../lib/spiderfy.ts";
import type { StoryGroup } from "../lib/types.ts";
import { compareGroups } from "./rank.ts";

/**
 * §2.4: K ~ 12-20, tuned on real data. A phone shows 2-4 tiles, so roughly 30-60
 * pins — which is §9's density target.
 */
export const DEFAULT_K = 15;

/**
 * The deepest zoom the budget assigns, matching tippecanoe's `-z12` (§3.1).
 *
 * §6 decision 1 caps *data* zoom at z10, meaning the map stops being useful past
 * it because GDELT gives city centroids and every Chicago story shares one
 * coordinate. The budget still runs to 12, because those two levels are where a
 * deferred story gets its last chance to "reappear on zoom-in" (§2.4).
 */
export const MAX_BUDGET_ZOOM = 12;

/**
 * Groups that never win a slot, even at MAX_BUDGET_ZOOM, are assigned
 * MAX_BUDGET_ZOOM + 1 — above tippecanoe's ceiling, so they are not rendered.
 *
 * This is a real cost and it is stated rather than hidden. The alternative —
 * dumping the remainder at the deepest zoom — breaks §9's "~30-60 pins at every
 * zoom, not more" outright, and the §2.4 floor layer already guarantees no
 * country vanishes. `assignMinzoom` returns the overflow count so worker/run.ts
 * can report it (§8) instead of letting it decay quietly.
 *
 * **Amended 2026-08-14, when spiderfy landed.** This block used to say that
 * co-located stories "collide at EVERY zoom, so zooming never separates them"
 * and that the overflow was therefore genuinely invisible. That is no longer
 * true: from `SPIDERFY_ZOOM` the client spreads a stack into legs and leaves, so
 * a deferred story is reachable by zooming into its city. **The overflow number
 * itself will move on the first run after this change and has not been re-read
 * yet** — the coordinate cap frees slots at shallow zooms (a stack of 14 held 14
 * of a tile's 15) while concentrating the competition at z9-12, and which effect
 * dominates is a measurement, not a guess. Read it off the next run (§8) before
 * drawing any conclusion about K.
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
    /**
     * §6 decision 1's coordinate cap. GDELT places every story in a city at the
     * SAME centroid, so below the spiderfy zoom a second story there is drawn
     * exactly underneath the first: invisible, and holding a budget slot that
     * another location could have used. Measured on the live archive, two thirds
     * of all visible stories were in such a stack — see `lib/spiderfy.ts`.
     *
     * So below `SPIDERFY_ZOOM` a coordinate holds one story, the best one. At
     * and above it the cap lifts, because that is exactly where the client can
     * spread the stack into legs and leaves and the pins stop overlapping.
     */
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

/**
 * The §2.4 floor: top 1 per country, EXEMPT from the tile budget, `minzoom` 0.
 *
 * At z0 the whole planet is one tile, so the budget alone would put 12-20
 * stories on the entire world map. This layer is what keeps the default view
 * populated regardless of salience — every country with news in the window gets
 * at least one pin (§9).
 *
 * It ranks on the same comparator, so a country whose only tier-1 story of the
 * last 48 hours is low-salience still shows THAT story as its representative.
 * That is the intended effect, not a side effect.
 */
export function countryTopGroups(groups: StoryGroup[]): StoryGroup[] {
  const best = new Map<string, StoryGroup>();

  for (const group of groups) {
    if (!group.countryCode) continue;
    const current = best.get(group.countryCode);
    if (!current || compareGroups(group, current) < 0) best.set(group.countryCode, group);
  }

  return [...best.values()].map((group) => ({ ...group, minzoom: 0 }));
}
