import { COUNTRY_LAYER_MAXZOOM } from "../src/lib/country-floor.ts";
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
  // Country-floor group ids. The floor layer stops drawing at COUNTRY_LAYER_MAXZOOM, so these
  // must be in the stories layer by then or the dot vanishes on zoom-in.
  floor?: ReadonlySet<string>;
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
    const occupied = new Set<string>();
    const capped = zoom < SPIDERFY_ZOOM;

    // Pass 1: an assigned group keeps occupying its tile at deeper zooms, which is what
    // keeps minzoom monotonic. Removing this pass lets deeper zooms evict it.
    for (const group of ranked) {
      const assigned = minzoom.get(group.id);
      if (assigned === undefined) continue;
      const { x, y } = tileOf(group.lat, group.lon, zoom);
      const key = tileKey(x, y);
      used.set(key, (used.get(key) ?? 0) + 1);
      if (capped) occupied.add(coordKey(group.lon, group.lat));
    }

    // Forced past K and the coordinate cap: at the handover a floor story either is here or
    // disappears. Pass 1 counts it at every deeper zoom, so K still holds for the rest.
    if (zoom === COUNTRY_LAYER_MAXZOOM && options.floor?.size) {
      for (const group of ranked) {
        if (!options.floor.has(group.id) || minzoom.has(group.id)) continue;
        const { x, y } = tileOf(group.lat, group.lon, zoom);
        const key = tileKey(x, y);
        used.set(key, (used.get(key) ?? 0) + 1);
        if (capped) occupied.add(coordKey(group.lon, group.lat));
        minzoom.set(group.id, zoom);
      }
    }

    for (const group of ranked) {
      if (minzoom.has(group.id)) continue;
      const coordinate = coordKey(group.lon, group.lat);
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

export function countryTopGroups(groups: StoryGroup[]): StoryGroup[] {
  const best = new Map<string, StoryGroup>();

  for (const group of groups) {
    if (!group.countryCode) continue;
    const current = best.get(group.countryCode);
    if (!current || compareGroups(group, current) < 0) best.set(group.countryCode, group);
  }

  return [...best.values()].map((group) => ({ ...group, minzoom: 0 }));
}
