/**
 * Co-located stories: one pin far out, a spider up close. Structural
 * problem, not cosmetic — GDELT gives city centroids, so every story in a
 * city shares one coordinate exactly, and roughly two-thirds of visible
 * stories were measured drawn directly underneath another one. See
 * docs/DESIGN.md#spiderfy. `SPIDERFY_ZOOM` lives here and is imported by
 * the worker rather than repeated: below it, `worker/budget.ts` admits
 * only the best story per coordinate so a stack can't form; at and above
 * it, the cap lifts and this module spreads the stack into legs and
 * leaves. Everything here is pure — pixel geometry in, GeoJSON out.
 */

import type { Feature, FeatureCollection } from "geojson";

// Where a stack stops being one pin and becomes a spider. Changing this
// changes the tiles, not just the client — the archive must be rebuilt
// for the two halves to line up again.
export const SPIDERFY_ZOOM = 9;

/** Pixel radius of the first ring of leaves, clear of the anchor's own disc. */
const BASE_RADIUS = 34;

/** How far each additional leaf pushes the ring out, so legs never overlap. */
const RADIUS_STEP = 5.2;

/** Beyond this a ring gets too tight to read, and the layout becomes a spiral. */
const RING_LIMIT = 8;

// The spiral's turn per leaf, and its growth. MUST be the golden angle,
// not an even division of the circle — an even step (2π/n) puts every nth
// leaf on the same bearing, so legs overlap into a few thick spokes; the
// golden angle never repeats a bearing (same reason a sunflower uses it).
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

// The comparator for members WITHIN a stack, deliberately the same one
// lib/top.ts ranks by: salience, then recency, then key. Must not read
// `tier1`, and must be total — the anchor changing under the reader as
// they pan would be worse than any ordering.
export const compareProperties = (a: StoryProperties, b: StoryProperties): number => {
  const salience = asNumber(b.salience) - asNumber(a.salience);
  if (salience !== 0) return salience;
  const dateA = asString(a.date);
  const dateB = asString(b.date);
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  return asString(a.url) < asString(b.url) ? -1 : 1;
};

// A coordinate, as a key. Exact, not rounded: co-location is not an
// accident of precision, it's the placement rule handing two stories the
// same city centroid. Two genuinely different points a metre apart stay
// two pins.
export const coordKey = (lng: number, lat: number): string => `${lng},${lat}`;

type RenderedFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: StoryProperties | null;
};

// Group rendered features into the stacks that need spreading. Deduped by
// URL first — one story renders once per visible world copy and again in
// the overlapping country floor, so without this a story would spider
// against itself. Only stacks of 2+ are returned.
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

// Pixel offsets for `count` leaves around an anchor: a ring while there's
// room, then an Archimedean spiral (grows radius with angle, keeping
// density constant) once a single ring would crowd leaves. Starts at 12
// o'clock, runs clockwise, so the layout is the same shape every time.
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

// Legs and leaves in ONE collection, one source, one setData per frame —
// a half-updated overlay (legs pointing at moved leaves) isn't representable.
export type SpiderData = FeatureCollection;

export const EMPTY_SPIDER: SpiderData = { type: "FeatureCollection", features: [] };

/**
 * The overlay: one leg per displaced member, one leaf on the end of it.
 * The best member stays at the anchor with no leaf — the stacked features
 * underneath (undrawable individually in a vector tile) are exactly
 * covered by the anchor's own disc, since the stack is sorted by the same
 * salience that sets the radius. Offsets are computed in PIXELS and
 * converted back through the live camera, so a spider keeps its shape at
 * every zoom.
 */
export function spiderData(
  stacks: readonly Stack[],
  projection: Projection,
  topUrls: readonly string[] = [],
  selectedUrl: string | null = null,
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
          // Highlight is feature state on the vector source, which a leaf in
          // a different source can't inherit, so it travels as a property
          // instead (lib/layers.ts reads either).
          top: top.has(asString(properties.url)) ? 1 : 0,
          // The open story's MARK fill, carried the same way.
          selected: selectedUrl !== null && asString(properties.url) === selectedUrl ? 1 : 0,
        },
      });
    });
  }

  // Legs first, so a leaf is never drawn under the line pointing at it.
  return { type: "FeatureCollection", features: [...legs, ...leaves] };
}

/**
 * The URLs of every member a spider has moved off its anchor. The vector
 * layers still draw these at the anchor (undrawable individually), covered
 * by the anchor's own larger disc — except the top-5 ring could poke out
 * from behind it if left on the anchor copy, so `MapView` withholds the
 * feature-state flag from these and puts the highlight on the LEAF instead,
 * where the reader can actually see it.
 */
export function displacedUrls(stacks: readonly Stack[]): Set<string> {
  const urls = new Set<string>();
  for (const stack of stacks) {
    for (const member of stack.members.slice(1)) urls.add(asString(member.url));
  }
  urls.delete("");
  return urls;
}

// Whether two stack sets describe the same spiders — avoids rebuilding the
// overlay on every frame of a pan for no visible change.
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
