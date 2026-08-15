/**
 * "Stories Nearby": the other stories around the one that was clicked.
 *
 * **Geographic, and computed from what is rendered.** The alternative was the
 * published region index (`lib/regions.ts`), which is already built and always
 * well populated — but it answers "top stories in California", not "stories near
 * this pin", and §2.3's panel already exists to answer the first question. Using
 * it here would have given the two panels the same list under two different
 * headings.
 *
 * Querying the rendered features costs no new data, works at every zoom, and
 * picks up the spider-stack case for free: §2.4's overlap puts many stories on
 * one GDELT city centroid, and every one of them is inside the radius of a click
 * on any of them. That stack is the truest possible reading of "nearby".
 *
 * **The cost of that choice, stated plainly:** at low zoom §2.4's budget thins
 * features to 15-16 per tile, so a click on a quiet part of the world can return
 * a short list or an empty one. That is the honest answer — those are the stories
 * near that point *on the map the reader is looking at* — and the panel renders
 * the empty case as a normal answer rather than an error.
 *
 * PURE, and separated from `MapView.tsx` for the reason `lib/layers.ts` and
 * `lib/story.ts` were: the radius, the cap and the ordering are product choices,
 * so they are worth a test rather than a review.
 */

import { panelStory, type PanelStory } from "./story";

/**
 * The click radius, in screen pixels.
 *
 * Sized against the pin, not against the finger. `lib/layers.ts` draws a story
 * disc at a few pixels of radius and the spider spreads leaves further than that,
 * so 60px reaches a comfortable ring of neighbours around the tap without
 * sweeping in a whole city at z12. It is a display constant, not a distance:
 * what counts as "nearby" is whatever looks nearby at the current zoom, which is
 * exactly what a pixel radius means and a kilometre radius does not.
 */
export const NEARBY_RADIUS_PX = 60;

/** How many neighbours the panel lists. The design shows six. */
export const NEARBY_LIMIT = 6;

/** The shape `queryRenderedFeatures` returns, narrowed to what is read here. */
export type RenderedFeature = {
  properties?: Record<string, unknown> | null;
};

const salienceOf = (feature: RenderedFeature): number => {
  const value = feature.properties?.salience;
  return typeof value === "number" ? value : 0;
};

/**
 * The neighbours of `excludeUrl`, best first, capped at `limit`.
 *
 * **Ordered by salience, not by distance.** Every feature handed in is already
 * near the click — that is what the radius query decided — so distance no longer
 * separates them usefully, and ordering by it would put an arbitrary two-pixel
 * difference ahead of the §2.5 ranking the whole pipeline exists to compute.
 * Salience is `log1p(domains) + 0.5 * log1p(sourceCountries)`, already on every
 * feature (`worker/tiles.ts`), so this is the same ordering the map itself uses.
 *
 * **Deduped by url**, because §2.4 draws the country floor and the stories layer
 * over each other by design and a single story is routinely rendered in both.
 * The url is the promoted feature id, so it is the identity the rest of the
 * client already agrees on.
 */
export function nearbyStories(
  features: readonly RenderedFeature[],
  excludeUrl: string,
  limit = NEARBY_LIMIT,
): PanelStory[] {
  const seen = new Set<string>([excludeUrl]);
  const found: { story: PanelStory; salience: number }[] = [];

  for (const feature of features) {
    const story = panelStory(feature.properties);
    if (!story || seen.has(story.url)) continue;
    seen.add(story.url);
    found.push({ story, salience: salienceOf(feature) });
  }

  return found
    .sort((a, b) => b.salience - a.salience)
    .slice(0, limit)
    .map((entry) => entry.story);
}

/**
 * The bounding box a radius query needs, as MapLibre wants it.
 *
 * `queryRenderedFeatures` takes a box rather than a circle, so this is a square
 * around the tap. The corners reach 1.41x the radius, which is close enough for a
 * list of neighbours and much cheaper than filtering the result by true distance.
 */
export function nearbyBox(
  point: { x: number; y: number },
  radius = NEARBY_RADIUS_PX,
): [[number, number], [number, number]] {
  return [
    [point.x - radius, point.y - radius],
    [point.x + radius, point.y + radius],
  ];
}
