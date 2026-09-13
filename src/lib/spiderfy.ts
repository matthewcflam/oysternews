import type { Feature, FeatureCollection } from "geojson";

// Imported by worker/budget.ts: changing it changes the tiles, so rebuild the archive too.
export const SPIDERFY_ZOOM = 9;

const BASE_RADIUS = 34;

const RADIUS_STEP = 5.2;

const RING_LIMIT = 8;

// Must be the golden angle: an even step repeats bearings, so legs overlap into spokes.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPIRAL_STEP = 7.5;

export type StoryProperties = Record<string, unknown>;

export type Stack = {
  lng: number;
  lat: number;
  members: StoryProperties[];
};

type Point = { x: number; y: number };
type LngLat = { lng: number; lat: number };

export type Projection = {
  project: (lngLat: [number, number]) => Point;
  unproject: (point: [number, number]) => LngLat;
};

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

// Same comparator as lib/top.ts. Must not read tier1, and must be total.
export const compareProperties = (a: StoryProperties, b: StoryProperties): number => {
  const salience = asNumber(b.salience) - asNumber(a.salience);
  if (salience !== 0) return salience;
  const dateA = asString(a.date);
  const dateB = asString(b.date);
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  return asString(a.url) < asString(b.url) ? -1 : 1;
};

// Exact, not rounded: co-located stories share a centroid exactly; nearby points stay two pins.
export const coordKey = (lng: number, lat: number): string => `${lng},${lat}`;

type RenderedFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: StoryProperties | null;
};

// Deduped by URL first: world copies and the country floor render one story more than once.
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
  return stacks.sort((a, b) => coordKey(a.lng, a.lat).localeCompare(coordKey(b.lng, b.lat)));
}

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

export type SpiderData = FeatureCollection;

export const EMPTY_SPIDER: SpiderData = { type: "FeatureCollection", features: [] };

export function leafPositions(
  stacks: readonly Stack[],
  projection: Projection
): Map<string, [number, number]> {
  const positions = new Map<string, [number, number]>();

  for (const stack of stacks) {
    const anchor = projection.project([stack.lng, stack.lat]);
    const displaced = stack.members.slice(1);
    const offsets = leafOffsets(displaced.length);

    displaced.forEach((properties, index) => {
      const [dx, dy] = offsets[index];
      const { lng, lat } = projection.unproject([anchor.x + dx, anchor.y + dy]);
      const url = asString(properties.url);
      if (url) positions.set(url, [lng, lat]);
    });
  }

  return positions;
}

export function spiderData(
  stacks: readonly Stack[],
  projection: Projection,
  topUrls: readonly string[] = [],
  selectedUrl: string | null = null
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
          // Feature state doesn't cross sources, so the highlight travels as a property.
          top: top.has(asString(properties.url)) ? 1 : 0,
          selected: selectedUrl !== null && asString(properties.url) === selectedUrl ? 1 : 0,
        },
      });
    });
  }

  return { type: "FeatureCollection", features: [...legs, ...leaves] };
}

export function displacedUrls(stacks: readonly Stack[]): Set<string> {
  const urls = new Set<string>();
  for (const stack of stacks) {
    for (const member of stack.members.slice(1)) urls.add(asString(member.url));
  }
  urls.delete("");
  return urls;
}

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
