/**
 * Story grouping. PURE (HANDOFF.md §3.3, §2.5).
 *
 * **This has to be real grouping, not title dedup.** Title dedup alone inverts
 * the signal it feeds: wire copy republished verbatim under one headline merges
 * into a single high-domain story, while the NYT, BBC and Guardian each writing
 * their own headline about the same event split into three 1-domain stories. The
 * outlets doing independent journalism would rank lowest. That is why grouping
 * lives in Phase 3 and not Phase 6.
 *
 * §2.5's key, all three parts required together:
 *
 *   >= 2 shared V2EnhancedThemes, excluding themes above the doc-frequency
 *   ceiling, AND a title-token Jaccard floor, AND the same 0.5 degree cell.
 *
 * Then exact-title dedup on top, to collapse syndication.
 *
 * **The theme ceiling is not optional.** Measured over one hour: 3,230 distinct
 * themes, of which `CRISISLEX_CRISISLEXREC` alone appears on 39.4% of articles,
 * `UNGP_FORESTS_RIVERS_OCEANS` on 32.7%, `WB_696_PUBLIC_SECTOR_MANAGEMENT` on
 * 31.7%. Nine themes exceed 20% and 105 exceed 5%. Without the ceiling,
 * CRISISLEX alone would join 39% of all articles to each other. FINDINGS §8
 * validated the rule as necessary and suggested tightening 20% to 15%, which is
 * the default here.
 */

import { createHash } from "node:crypto";
import type { PlacedArticle, StoryGroup } from "../lib/types.ts";
import { summarise } from "./rank.ts";

/** FINDINGS §8: 9 themes exceed 20%, so 15% excludes a few more and costs nothing. */
export const THEME_CEILING = 0.15;

/**
 * Title-token Jaccard floor. Two headlines about the same event share proper
 * nouns; two unrelated headlines that happen to share two themes and a cell do
 * not. 0.25 is a starting point tuned by eye on real bundles rather than fitted
 * — it is the one constant here without a measurement behind it, and it is worth
 * revisiting once real placements can be judged.
 */
export const JACCARD_FLOOR = 0.25;

/** §2.5: the location half of the key. Roughly 55 km at the equator. */
export const CELL_DEGREES = 0.5;

/**
 * Tokens carrying no distinguishing information. Deliberately short: a real stop
 * list would start deleting the words that separate two stories.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with",
  "from", "by", "as", "is", "are", "was", "were", "be", "been", "it", "its", "this",
  "that", "these", "those", "will", "has", "have", "had", "not", "new", "says", "said",
  "after", "over", "into", "about", "up", "out", "more", "than", "his", "her", "their",
]);

export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Exact-syndication key: the same headline, punctuation and spacing aside. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEGREES)}:${Math.floor(lon / CELL_DEGREES)}`;
}

/** Themes appearing on more than `ceiling` of articles carry no grouping signal. */
export function overCommonThemes(articles: PlacedArticle[], ceiling = THEME_CEILING): Set<string> {
  const documentFrequency = new Map<string, number>();
  for (const article of articles) {
    for (const theme of new Set(article.themes)) {
      documentFrequency.set(theme, (documentFrequency.get(theme) ?? 0) + 1);
    }
  }

  const limit = ceiling * Math.max(articles.length, 1);
  const common = new Set<string>();
  for (const [theme, count] of documentFrequency) {
    if (count > limit) common.add(theme);
  }
  return common;
}

class DisjointSet {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(node: number): number {
    while (this.parent[node] !== node) {
      this.parent[node] = this.parent[this.parent[node]];
      node = this.parent[node];
    }
    return node;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

export type GroupOptions = {
  themeCeiling?: number;
  jaccardFloor?: number;
  /** Injected so the 48-hour tier-1 test is not a test that has to wait. */
  now?: number;
};

/**
 * Group placed articles into stories.
 *
 * Comparison is scoped to a cell and driven by an inverted theme index, so the
 * pairwise cost is paid only between articles that already share a significant
 * theme and a location. A naive all-pairs pass over a 24-hour window (~40,700
 * articles) would be 830M comparisons.
 */
export function groupArticles(
  articles: PlacedArticle[],
  options: GroupOptions = {},
): StoryGroup[] {
  const now = options.now ?? Date.now();
  const jaccardFloor = options.jaccardFloor ?? JACCARD_FLOOR;
  const common = overCommonThemes(articles, options.themeCeiling ?? THEME_CEILING);

  const sets = new DisjointSet(articles.length);
  const tokens = articles.map((article) => titleTokens(article.title));
  const significant = articles.map(
    (article) => new Set(article.themes.filter((theme) => !common.has(theme))),
  );

  /** cell -> theme -> article indices. */
  const index = new Map<string, Map<string, number[]>>();
  /** cell -> normalized title -> first article index with it. */
  const syndication = new Map<string, Map<string, number>>();

  articles.forEach((article, i) => {
    const cell = cellOf(article.lat, article.lon);

    // Exact-title syndication, collapsed first and unconditionally: the same
    // headline in the same cell is the same story whatever its themes say.
    // Scoped to the cell on purpose — "Weather warning issued" is a real
    // headline in a dozen unrelated places on any given day.
    let titles = syndication.get(cell);
    if (!titles) {
      titles = new Map();
      syndication.set(cell, titles);
    }
    const normalized = normalizeTitle(article.title);
    const twin = titles.get(normalized);
    if (twin !== undefined) sets.union(twin, i);
    else titles.set(normalized, i);

    let themes = index.get(cell);
    if (!themes) {
      themes = new Map();
      index.set(cell, themes);
    }

    // Candidates: articles in this cell sharing at least one significant theme.
    // Two shared themes are required, so a single shared theme only makes a pair
    // worth testing.
    const candidates = new Set<number>();
    for (const theme of significant[i]) {
      for (const other of themes.get(theme) ?? []) candidates.add(other);
    }

    for (const other of candidates) {
      if (sets.find(other) === sets.find(i)) continue;

      let shared = 0;
      for (const theme of significant[i]) {
        if (significant[other].has(theme)) {
          shared++;
          if (shared >= 2) break;
        }
      }
      if (shared < 2) continue;
      if (jaccard(tokens[i], tokens[other]) < jaccardFloor) continue;

      sets.union(other, i);
    }

    for (const theme of significant[i]) {
      const bucket = themes.get(theme);
      if (bucket) bucket.push(i);
      else themes.set(theme, [i]);
    }
  });

  const members = new Map<number, PlacedArticle[]>();
  articles.forEach((article, i) => {
    const root = sets.find(i);
    const bucket = members.get(root);
    if (bucket) bucket.push(article);
    else members.set(root, [article]);
  });

  return [...members.values()].map((group) => buildGroup(group, now));
}

/**
 * The representative article shown in the popup and in a container's label.
 *
 * A tier-1 article wins when the group has one, newest first — the group is on
 * the map because of that coverage (§2.5), so showing a syndicated rewrite of it
 * would be odd. Otherwise the newest article wins.
 */
function representative(members: PlacedArticle[]): PlacedArticle {
  let best = members[0];
  for (const member of members) {
    if (member.tier1 !== best.tier1) {
      if (member.tier1) best = member;
      continue;
    }
    if (member.date > best.date) best = member;
  }
  return best;
}

function buildGroup(members: PlacedArticle[], now: number): StoryGroup {
  const face = representative(members);
  const stats = summarise(members, now);

  // Identity seeded from the OLDEST member's url, so a group keeps its id across
  // runs while that article stays in the window — a hash over all members would
  // change every time one more outlet picked the story up.
  const oldest = members.reduce((a, b) => (a.date <= b.date ? a : b));
  const id = createHash("sha1").update(oldest.url).digest("hex").slice(0, 16);

  return {
    id,
    title: face.title,
    url: face.url,
    domain: face.domain,
    lat: face.lat,
    lon: face.lon,
    kind: face.kind,
    countryCode: face.countryCode,
    regionId: face.regionId,
    adm1: face.adm1,
    placeName: face.placeName,
    minzoom: 0,
    ...stats,
  };
}
