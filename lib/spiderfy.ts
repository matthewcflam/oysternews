/**
 * Co-located stories: one pin far out, a spider up close (HANDOFF.md §6 decision 1).
 *
 * **The problem is structural, not cosmetic.** GDELT gives city centroids, so
 * every Chicago story shares one coordinate exactly — `worker/budget.ts` has said
 * so since it was written, and §6 decision 1 named spiderfy as the fix and then
 * deferred it. Measured on the live archive, 2026-08-14:
 *
 * | view       | stories | locations | stories in a stack | biggest stack |
 * | ---------- | ------- | --------- | ------------------ | ------------- |
 * | US z5      | 52      | 25        | 36 (69%)           | 11            |
 * | US z7      | 49      | 22        | 33 (67%)           | 14            |
 * | Chicago z9 | 33      | 15        | 23 (70%)           | 14            |
 * | London z9  | 44      | 24        | 27 (61%)           | 13            |
 *
 * Two thirds of every visible story was drawn underneath another one. It cost
 * twice: a stack of 14 renders as a single disc with the others' white rings
 * bleeding out from behind it — the "oddly coloured pin" — and it spent 14 of
 * that tile's 15 budget slots to show one location.
 *
 * The two halves have to agree on one number, which is why `SPIDERFY_ZOOM` lives
 * here and is imported by the worker rather than repeated:
 *
 * - **Below it**, `worker/budget.ts` admits only the best story per coordinate,
 *   so a stack cannot form and the freed slots go to other locations.
 * - **At and above it**, the cap lifts, the whole stack is in the tiles, and this
 *   module spreads it into legs and leaves.
 *
 * Everything here is pure — pixel geometry in, GeoJSON out — because the map is
 * the one thing that cannot be asserted in a test.
 */

import type { Feature, FeatureCollection } from "geojson";

/**
 * Where a stack stops being one pin and becomes a spider.
 *
 * z9 is a metropolitan area on screen: close enough that "several stories from
 * this city" is the question being asked, and far enough that the §2.4 density
 * target still holds. **Changing it changes the tiles**, not just the client —
 * the archive must be rebuilt for the two halves to line up again.
 */
export const SPIDERFY_ZOOM = 9;

/** Pixel radius of the first ring of leaves, clear of the anchor's own disc. */
const BASE_RADIUS = 34;

/** How far each additional leaf pushes the ring out, so legs never overlap. */
const RADIUS_STEP = 5.2;

/** Beyond this a ring gets too tight to read, and the layout becomes a spiral. */
const RING_LIMIT = 8;

/**
 * The spiral's turn per leaf, and its growth.
 *
 * **The golden angle, not an even division of the circle.** Stepping by
 * `2π/n` puts every nth leaf on the same bearing, so the legs of a 14-member
 * stack lie on top of each other and the spider reads as a few thick spokes.
 * The golden angle never repeats a bearing, which is the same reason a sunflower
 * uses it. Measured against the first attempt (an even step and a 2.4× growth):
 * the outermost leaf sat ~240px from its anchor, two suburbs away from the city
 * it belongs to. This keeps a 14-stack inside ~130px.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPIRAL_STEP = 7.5;

export type StoryProperties = Record<string, unknown>;

export type Stack = {
  lng: number;
  lat: number;
  /** Best first, by the same comparator the top-5 highlight uses. */
  members: StoryProperties[];
};

type Point = { x: number; y: number };
type LngLat = { lng: number; lat: number };

/** The two map methods this needs, named so tests can supply plain functions. */
export type Projection = {
  project: (lngLat: [number, number]) => Point;
  unproject: (point: [number, number]) => LngLat;
};

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The comparator for members WITHIN a stack, which is deliberately the same one
 * `lib/top.ts` ranks by: salience, then recency, then key. It must not read
 * `tier1` (§2.3), and it must be total — the anchor of a spider changing under
 * the reader as they pan would be worse than any ordering.
 */
export const compareProperties = (a: StoryProperties, b: StoryProperties): number => {
  const salience = asNumber(b.salience) - asNumber(a.salience);
  if (salience !== 0) return salience;
  const dateA = asString(a.date);
  const dateB = asString(b.date);
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  return asString(a.url) < asString(b.url) ? -1 : 1;
};

/**
 * A coordinate, as a key. **Exact, not rounded**: co-location here is not an
 * accident of precision, it is the placement rule handing two stories the same
 * city centroid. Two genuinely different points a metre apart are two pins.
 */
export const coordKey = (lng: number, lat: number): string => `${lng},${lat}`;

type RenderedFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: StoryProperties | null;
};

/**
 * Group rendered features into the stacks that need spreading.
 *
 * Deduplicated by URL first, because one story is rendered once per visible copy
 * of the world (`renderWorldCopies`) and again in the country floor where the
 * layers overlap (§2.4) — without this a single story would spider against
 * itself. Only stacks of two or more are returned; a lone pin is already right.
 */
export function stacksFrom(features: readonly RenderedFeature[]): Stack[] {
  const seen = new Set<string>();
  const byCoord = new Map<string, Stack>();

  for (const feature of features) {
    const properties = feature.properties;
    const url = asString(properties?.url);
    if (!properties || !url || seen.has(url)) continue;
    if (feature.geometry?.type !== "Point") continue;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lng, lat] = coordinates as [number, number];
    if (typeof lng !== "number" || typeof lat !== "number") continue;

    seen.add(url);
    const key = coordKey(lng, lat);
    const stack = byCoord.get(key);
    if (stack) stack.members.push(properties);
    else byCoord.set(key, { lng, lat, members: [properties] });
  }

  const stacks: Stack[] = [];
  for (const stack of byCoord.values()) {
    if (stack.members.length < 2) continue;
    stack.members.sort(compareProperties);
    stacks.push(stack);
  }
  // Sorted by coordinate so the output is stable between calls — the overlay is
  // diffed against the previous one to decide whether to repaint.
  return stacks.sort((a, b) => coordKey(a.lng, a.lat).localeCompare(coordKey(b.lng, b.lat)));
}

/**
 * Pixel offsets for `count` leaves around an anchor.
 *
 * A ring while the legs still have room, then an Archimedean spiral: at 14
 * members — the biggest stack measured — a single ring would put leaves closer
 * to each other than to the anchor, which is the crowding this feature exists to
 * remove. The spiral grows its radius with its angle, so density stays constant.
 *
 * The first leaf is placed at 12 o'clock and they run clockwise, so the layout
 * is the same shape every time a reader opens the same city.
 */
export function leafOffsets(count: number): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  if (count <= 0) return offsets;

  if (count <= RING_LIMIT) {
    const radius = BASE_RADIUS + RADIUS_STEP * count;
    for (let index = 0; index < count; index++) {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      offsets.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    return offsets;
  }

  for (let index = 0; index < count; index++) {
    const angle = GOLDEN_ANGLE * index - Math.PI / 2;
    const radius = BASE_RADIUS + SPIRAL_STEP * index;
    offsets.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return offsets;
}

/**
 * Legs and leaves in ONE collection, and therefore one source and one `setData`
 * per frame. The line layer ignores the points and the circle layer filters to
 * them, so the split costs nothing and a half-updated overlay — legs pointing at
 * leaves that have already moved — is not representable.
 */
export type SpiderData = FeatureCollection;

export const EMPTY_SPIDER: SpiderData = { type: "FeatureCollection", features: [] };

/**
 * The overlay: one leg per displaced member, one leaf on the end of it.
 *
 * **The best member stays at the anchor and gets no leaf.** The stacked features
 * underneath it are still drawn by the vector layers — nothing can hide an
 * individual feature in a vector tile — but they are exactly covered by the
 * anchor's own disc, which is the largest of the stack because the stack is
 * sorted by the salience that sets the radius. That is what makes an overlay
 * sufficient here, and why the sort is not merely cosmetic.
 *
 * Offsets are computed in PIXELS and converted back through the live camera, so
 * a spider keeps its shape and size at every zoom instead of stretching.
 */
export function spiderData(
  stacks: readonly Stack[],
  projection: Projection,
  topUrls: readonly string[] = [],
): SpiderData {
  const top = new Set(topUrls);
  const legs: Feature[] = [];
  const leaves: Feature[] = [];

  for (const stack of stacks) {
    const anchor = projection.project([stack.lng, stack.lat]);
    const displaced = stack.members.slice(1);
    const offsets = leafOffsets(displaced.length);

    displaced.forEach((properties, index) => {
      const [dx, dy] = offsets[index];
      const { lng, lat } = projection.unproject([anchor.x + dx, anchor.y + dy]);

      legs.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [stack.lng, stack.lat],
            [lng, lat],
          ],
        },
        properties: {},
      });

      leaves.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          ...properties,
          // The highlight is feature state on the vector source, which a leaf in
          // a different source cannot inherit — so it travels as a property and
          // `lib/layers.ts` reads either.
          top: top.has(asString(properties.url)) ? 1 : 0,
        },
      });
    });
  }

  // Legs first so that, in any renderer that honours source order, a leaf is
  // never drawn under the line that points at it.
  return { type: "FeatureCollection", features: [...legs, ...leaves] };
}

/**
 * The URLs of every member that a spider has moved off its anchor.
 *
 * The vector layers still draw these at the anchor — nothing can hide an
 * individual feature in a vector tile — and the header explains why that is
 * harmless: the anchor is the largest disc of the stack, so it covers them.
 * **The top-5 treatment is the one thing that can break that**, because
 * `TOP_SCALE` draws a marked story 15% proud of its own footprint, and a marked
 * story sitting third in a stack would then poke out from behind the pin on top
 * of it — measured on the live map 2026-08-14, and it is exactly the "salient
 * pin drawn behind a normal pin" it looks like.
 *
 * So `MapView` withholds the feature-state flag from these: a displaced story
 * wears its highlight on its LEAF, which is where the reader can see it, and its
 * covered copy at the anchor stays covered.
 */
export function displacedUrls(stacks: readonly Stack[]): Set<string> {
  const urls = new Set<string>();
  for (const stack of stacks) {
    for (const member of stack.members.slice(1)) urls.add(asString(member.url));
  }
  urls.delete("");
  return urls;
}

/**
 * Whether two stack sets describe the same spiders. Purely to avoid rebuilding
 * the overlay on every frame of a pan, which would allocate a few hundred
 * features per second for no visible change.
 */
export function sameStacks(a: readonly Stack[], b: readonly Stack[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((stack, index) => {
    const other = b[index];
    return (
      stack.lng === other.lng &&
      stack.lat === other.lat &&
      stack.members.length === other.members.length &&
      stack.members.every((member, i) => member.url === other.members[i].url)
    );
  });
}
