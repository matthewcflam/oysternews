// Total order: half of all stories tie on salience, so without the date/key tiebreaks a
// one-pixel pan flickers the highlight.

import { compareProperties, type StoryProperties } from "./spiderfy";

export const TOP_COUNT = 5;

export type RankedFeature = {
  properties?: Record<string, unknown> | null;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export function topKeys(features: readonly RankedFeature[], count = TOP_COUNT): string[] {
  const best = new Map<string, StoryProperties>();

  for (const feature of features) {
    const properties = feature.properties;
    const key = asString(properties?.url);
    // No URL means no identity: it must not take a slot.
    if (!properties || !key || best.has(key)) continue;
    best.set(key, properties);
  }

  // Same comparator as a spider's members, so the highlight and the anchor always agree.
  return [...best.values()]
    .sort(compareProperties)
    .slice(0, count)
    .map((properties) => String(properties.url));
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
