/**
 * Which stories are "the top 5 on screen." Separated from `MapView.tsx`
 * for the same reason `layers.ts` is: the ranking is a product rule, not
 * wiring. Ranked by salience, never tier-1 (a top-5 highlight is exactly
 * the badge tier-1 must stay invisible from). Deduplicated by URL, since
 * `renderWorldCopies` and the country-floor overlap can render one story
 * more than once. Total order: half of all stories tie at the same
 * salience, so without date/key tiebreaks a one-pixel pan would flicker
 * the highlight. See docs/DESIGN.md#the-tier-1-comparator.
 */

import { compareProperties, type StoryProperties } from "./spiderfy";

/** Five, from the identity sheet. */
export const TOP_COUNT = 5;

/** The identity of a story on the client is `url` — the group id is never serialised into the tiles, and url is the only property unique per group by construction. */
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
