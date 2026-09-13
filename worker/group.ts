import { createHash } from "node:crypto";
import type { PlacedArticle, StoryGroup } from "../src/lib/types.ts";
import { summarise } from "./rank.ts";

export const THEME_CEILING = 0.15;

export const JACCARD_FLOOR = 0.25;

export const CELL_DEGREES = 0.5;

// Deliberately short: real stopword list would delete separating words.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "will",
  "has",
  "have",
  "had",
  "not",
  "new",
  "says",
  "said",
  "after",
  "over",
  "into",
  "about",
  "up",
  "out",
  "more",
  "than",
  "his",
  "her",
  "their",
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

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEGREES)}:${Math.floor(lon / CELL_DEGREES)}`;
}

function documentFrequency(articles: PlacedArticle[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const theme of new Set(article.themes)) {
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
  }
  return counts;
}

export function overCommonThemes(articles: PlacedArticle[], ceiling = THEME_CEILING): Set<string> {
  const counts = documentFrequency(articles);

  const limit = ceiling * Math.max(articles.length, 1);
  const common = new Set<string>();
  for (const [theme, count] of counts) {
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
  now?: number;
};

export function groupArticles(articles: PlacedArticle[], options: GroupOptions = {}): StoryGroup[] {
  const now = options.now ?? Date.now();
  const jaccardFloor = options.jaccardFloor ?? JACCARD_FLOOR;
  const common = overCommonThemes(articles, options.themeCeiling ?? THEME_CEILING);

  const sets = new DisjointSet(articles.length);
  const tokens = articles.map((article) => titleTokens(article.title));
  const significant = articles.map(
    (article) => new Set(article.themes.filter((theme) => !common.has(theme)))
  );

  const index = new Map<string, Map<string, number[]>>();
  const syndication = new Map<string, Map<string, number>>();

  articles.forEach((article, i) => {
    const cell = cellOf(article.lat, article.lon);

    // Same headline in the same cell is one story whatever its themes say. Scoped to the
    // cell: "Weather warning issued" is a real headline in many unrelated places at once.
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

  // Seeded from the OLDEST member's url so the id is stable across runs; hashing all
  // members would change it every time another outlet picks the story up.
  const oldest = members.reduce((a, b) => (a.date <= b.date ? a : b));
  const id = createHash("sha1").update(oldest.url).digest("hex").slice(0, 16);

  return {
    id,
    title: face.title,
    url: face.url,
    domain: face.domain,
    image: face.image,
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
