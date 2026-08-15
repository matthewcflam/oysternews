/**
 * Which stories are "the top 5 on screen" (the pin identity's first state).
 *
 * Separated from `MapView.tsx` for the same reason `layers.ts` is: the ranking is
 * a product rule, not wiring. Three of its decisions are load-bearing and tested
 * in `top.test.ts`:
 *
 * 1. **Ranked by salience, never by tier-1.** §2.3 keeps the tier-1 preference
 *    invisible — it decides *which* stories the budget admitted, and it is not
 *    allowed to become a badge. A top-5 highlight is exactly the badge §2.3
 *    forbids, so the comparator here is deliberately NOT §2.5's full comparator.
 * 2. **Deduplicated by URL.** With `renderWorldCopies` on, one story is rendered
 *    once per visible copy of the world, and below z4 the same group can also be
 *    in both the stories layer and the country floor (§2.4's overlap). Ranking
 *    the raw query result would spend all five slots on one story at z1.
 * 3. **Total order.** Half of all stories sit at exactly log1p(1) salience
 *    (§2.5), so ties are the common case, not the edge case. Without the date
 *    and key tiebreaks, panning the map by one pixel would reshuffle which of a
 *    dozen equal stories is "top 5" and the highlight would flicker.
 */

import { compareProperties, type StoryProperties } from "./spiderfy";

/** Five, from the identity sheet. */
export const TOP_COUNT = 5;

/**
 * The identity of a story on the client. **`url` is it** — the group id is not
 * serialised into the tiles (`worker/tiles.ts` writes only §2.6's property list),
 * and it is the only property that is unique per group by construction.
 */
export type RankedFeature = {
  properties?: Record<string, unknown> | null;
};

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The top `count` story keys among the features currently rendered, best first.
 *
 * Takes anything with `properties` so the caller can hand it MapLibre's
 * `queryRenderedFeatures` result directly and the test can hand it plain objects.
 */
export function topKeys(features: readonly RankedFeature[], count = TOP_COUNT): string[] {
  const best = new Map<string, StoryProperties>();

  for (const feature of features) {
    const properties = feature.properties;
    const key = asString(properties?.url);
    // A feature with no URL cannot be identified, so it cannot be marked, so it
    // must not occupy a slot — silently dropping it is the only honest answer.
    if (!properties || !key || best.has(key)) continue;
    best.set(key, properties);
  }

  // The SAME comparator that orders a spider's members, because they answer the
  // same question — which of these stories is the one to read — and a map where
  // the highlight and the anchor disagreed would be telling two stories.
  return [...best.values()]
    .sort(compareProperties)
    .slice(0, count)
    .map((properties) => String(properties.url));
}

/** Two key lists are the same set, in order — the "nothing to repaint" check. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
