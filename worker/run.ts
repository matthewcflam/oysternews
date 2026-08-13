/**
 * Orchestration only (HANDOFF.md §3.3). Every decision in the pipeline lives in
 * one of the modules this calls; what is here is the ORDER, and the order is
 * where §5's bullet list says the bugs are.
 *
 * The §3.2 data flow, and why each step sits where it does:
 *
 *   fetch    -> watermark to now, capped at 12 bundles
 *   parse    -> index-scan, V2GCAM never materialized
 *   filter   -> blocklist FIRST, so a blocked domain can never make a group
 *               tier-1-fresh (§5; a one-line ordering guarantee against a
 *               future list edit, not a bug that exists today)
 *   place    -> Rule H; the demonym filter runs inside it, before placement
 *   state    -> append this run's shards, THEN read the pool, so the 24h/48h
 *               union includes what just arrived and is deduped once
 *   group    -> themes + Jaccard + 0.5 cell
 *   rank     -> tier-1-fresh first, then salience
 *   budget   -> per-tile top-K -> monotonic minzoom
 *   tiles    -> tippecanoe, two layers
 *   publish  -> invariants, then archive, then the manifest flip
 *   prune    -> only AFTER the flip, and only if it flipped
 *   ping     -> only after a real publish
 *
 * **The watermark comes from the published manifest, not from local state.** It
 * is therefore the last *successfully published* bundle: a run that fetches,
 * groups, and then fails its invariants does not advance it, and the next run
 * asks for the same span again rather than stepping over a window it never
 * showed anyone. Re-fetching is free — `readPool` dedupes by `(domain, url)`.
 *
 * **Nothing here is silent.** A run that publishes nothing exits non-zero so the
 * Action fails and §8's "run throws" email fires, and it does not ping the
 * healthcheck, so §8's dead-man switch fires too. Those are two independent
 * alarms on the same event, which is the intent: the failure this project is
 * most afraid of is the one nobody notices.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Article, Placement, PlacedArticle } from "../lib/types.ts";
import { assignMinzoom, countryTopGroups } from "./budget.ts";
import { MAX_BUNDLES, fetchBundle, newestStamp, stampsToFetch } from "./fetch.ts";
import { filterArticles } from "./filter.ts";
import { groupArticles } from "./group.ts";
import { parseBundle } from "./parse.ts";
import { placeStory } from "./place.ts";
import {
  MANIFEST_KEY,
  type ArchiveStore,
  assertStoreReachable,
  pingHealthcheck,
  publish,
  vercelBlobStore,
} from "./publish.ts";
import { rankGroups } from "./rank.ts";
import { type RefData, assertUsable, loadRefData, sourceCountry } from "./refdata.ts";
import { appendShards, pruneShards, readPool } from "./state.ts";
import { buildTiles } from "./tiles.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = path.join(REPO_ROOT, "build", "run");
const ARCHIVE_PATH = path.join(REPO_ROOT, "build", "stories.pmtiles");

/** A Date as GKG's YYYYMMDDHHMMSS, UTC. */
export function stampOfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/**
 * Article + Placement -> the record that gets stored and grouped.
 *
 * Pure, and exported for that reason: this is the only place the three
 * reference-data lookups (source country, tier-1 membership, FIPS validity) are
 * applied to a story, and getting tier-1 membership wrong here would disable
 * §2.5 silently — the comparator would still run, just never on a tier-1 group.
 */
export function toPlaced(
  article: Article,
  placement: Placement,
  data: RefData,
): PlacedArticle | null {
  if (placement.kind === "DROP") return null;
  const { location } = placement;
  return {
    date: article.date,
    domain: article.domain,
    url: article.url,
    title: article.title,
    themes: article.themes,
    lat: location.lat,
    lon: location.lon,
    kind: placement.kind,
    countryCode: location.countryCode,
    regionId: placement.kind === "CONTAINER" ? placement.regionId : "",
    placeName: location.name,
    sourceCountry: sourceCountry(article.domain, data),
    tier1: data.tier1.has(article.domain),
  };
}

/**
 * A FIPS code the crosswalk does not know and §3.4 has not marked as a known
 * non-country. §8 wants these logged loudly and counted, because the degraded
 * behaviour — a plain pin — looks completely normal on the map.
 */
function unknownFips(placed: PlacedArticle[], data: RefData): Map<string, number> {
  const unknown = new Map<string, number>();
  for (const article of placed) {
    const code = article.countryCode;
    if (!code || data.countries.has(code) || data.nonCountries.has(code)) continue;
    unknown.set(code, (unknown.get(code) ?? 0) + 1);
  }
  return unknown;
}

export type RunSummary = {
  watermark: string;
  bundlesRequested: number;
  bundlesFetched: number;
  bundlesMissing: number;
  rows: number;
  shortRows: number;
  noTitle: number;
  blocked: number;
  noLocation: number;
  dropped: number;
  placed: number;
  unknownFips: Map<string, number>;
  poolSize: number;
  shardsRead: number;
  duplicatesDropped: number;
  badLines: number;
  groups: number;
  tier1Groups: number;
  countryTop: number;
  overflow: number;
  published: boolean;
  violations: string[];
  archive: string;
  prunedArchives: number;
  prunedShards: number;
  pinged: boolean;
};

export type RunOptions = {
  store: ArchiveStore;
  now?: Date;
  /** Cap on bundles fetched. Lowered by hand for a smoke run against real GDELT. */
  cap?: number;
  healthcheckUrl?: string;
};

/** The watermark of the last successful publish, or "" on a first run. */
async function lastWatermark(store: ArchiveStore): Promise<string> {
  try {
    const manifest = JSON.parse(await store.get(MANIFEST_KEY)) as { watermark?: string };
    return typeof manifest.watermark === "string" ? manifest.watermark : "";
  } catch {
    // No manifest yet, or an unreadable one. Both mean "take the newest bundles
    // and start from there", which stampsToFetch already does with "".
    return "";
  }
}

export async function run(options: RunOptions): Promise<RunSummary> {
  const { store } = options;
  const now = options.now ?? new Date();
  const runStamp = stampOfDate(now);

  const data = await loadRefData();
  assertUsable(data);

  // --- fetch ---------------------------------------------------------------
  const watermark = await lastWatermark(store);
  const newest = await newestStamp();
  const stamps = stampsToFetch(watermark, newest, options.cap ?? MAX_BUNDLES);

  const articles: Article[] = [];
  let rows = 0;
  let shortRows = 0;
  let noTitle = 0;
  let fetched = 0;
  let newestFetched = watermark;

  for (const stamp of stamps) {
    const bundle = await fetchBundle(stamp);
    // GDELT skips slots. A miss is counted, never fatal (§3.5).
    if (!bundle) continue;
    fetched++;
    newestFetched = stamp > newestFetched ? stamp : newestFetched;

    const parsed = parseBundle(bundle.csv);
    articles.push(...parsed.articles);
    rows += parsed.rows;
    shortRows += parsed.shortRows;
    noTitle += parsed.noTitle;
  }

  // --- filter, place -------------------------------------------------------
  const filtered = filterArticles(articles, data);
  const placed: PlacedArticle[] = [];
  let dropped = 0;
  for (const article of filtered.kept) {
    const record = toPlaced(article, placeStory(article, data), data);
    if (record) placed.push(record);
    else dropped++;
  }

  // --- state ---------------------------------------------------------------
  // Append before reading: the pool is then one deduped union rather than this
  // run's articles concatenated onto a pool that also contains them.
  await appendShards(store, runStamp, placed);
  const pool = await readPool(store, now.getTime());

  // --- group, rank, budget -------------------------------------------------
  const grouped = groupArticles(pool.articles, { now: now.getTime() });
  const ranked = rankGroups(grouped);
  const { groups: budgeted, overflow } = assignMinzoom(ranked);
  const countryTop = countryTopGroups(budgeted);

  // --- tiles ---------------------------------------------------------------
  await buildTiles(budgeted, countryTop, WORK_DIR, ARCHIVE_PATH);

  // --- publish -------------------------------------------------------------
  const result = await publish({
    store,
    archivePath: ARCHIVE_PATH,
    groups: budgeted,
    watermark: newestFetched,
    now,
  });

  let prunedShards = 0;
  let pinged = false;
  if (result.published) {
    // Only now. A run that published nothing must leave the state it read
    // intact, or a transient failure permanently shrinks its own window.
    prunedShards = await pruneShards(store, now.getTime());
    pinged = await pingHealthcheck(options.healthcheckUrl);
  }

  return {
    watermark,
    bundlesRequested: stamps.length,
    bundlesFetched: fetched,
    bundlesMissing: stamps.length - fetched,
    rows,
    shortRows,
    noTitle,
    blocked: filtered.blocked,
    noLocation: filtered.noLocation,
    dropped,
    placed: placed.length,
    unknownFips: unknownFips(placed, data),
    poolSize: pool.articles.length,
    shardsRead: pool.shardsRead,
    duplicatesDropped: pool.duplicatesDropped,
    badLines: pool.badLines,
    groups: budgeted.length,
    tier1Groups: budgeted.filter((group) => group.tier1Fresh).length,
    countryTop: countryTop.length,
    overflow,
    published: result.published,
    violations: result.published ? [] : result.violations,
    archive: result.published ? result.manifest.archive : "",
    prunedArchives: result.published ? result.pruned : 0,
    prunedShards,
    pinged,
  };
}

/**
 * The run summary. This is the only interface §8 has to five of its seven
 * failure modes, so it prints unconditionally, including on the failure path.
 */
export function formatSummary(summary: RunSummary): string {
  const lines = [
    `watermark    ${summary.watermark || "(none)"} -> ${summary.bundlesFetched} of ${summary.bundlesRequested} bundles (${summary.bundlesMissing} missing)`,
    `parse        ${summary.rows} rows, ${summary.shortRows} short, ${summary.noTitle} untitled`,
    `filter       ${summary.blocked} blocklisted, ${summary.noLocation} unplaceable`,
    `place        ${summary.placed} placed, ${summary.dropped} dropped`,
    `pool         ${summary.poolSize} articles from ${summary.shardsRead} shards (${summary.duplicatesDropped} dupes, ${summary.badLines} bad lines)`,
    `groups       ${summary.groups} groups, ${summary.tier1Groups} tier-1, ${summary.countryTop} country-top, ${summary.overflow} overflow`,
  ];

  // §8: a schema change shows up here first, as a nonzero short-row count.
  if (summary.shortRows > 0) {
    lines.push(`WARN         ${summary.shortRows} rows failed the schema canary — GDELT may have changed`);
  }
  // §8: the tier-1 count going to zero is the silent-degradation case. Nothing
  // else fails when it happens, which is exactly why it is called out.
  if (summary.groups > 0 && summary.tier1Groups === 0) {
    lines.push("WARN         no tier-1 groups — §2.5 has degraded to plain salience");
  }
  for (const [code, count] of summary.unknownFips) {
    lines.push(`WARN         unknown FIPS code ${code} on ${count} stories — needs a data/fips-overrides entry`);
  }

  if (summary.published) {
    lines.push(
      `published    ${summary.archive}, pruned ${summary.prunedArchives} archives and ${summary.prunedShards} shards`,
      `healthcheck  ${summary.pinged ? "pinged" : "NOT pinged — check HEALTHCHECK_URL"}`,
    );
  } else {
    lines.push("PUBLISHED    NOTHING — output invariants failed:");
    for (const violation of summary.violations) lines.push(`             ${violation}`);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const store = vercelBlobStore(token);

  // Here rather than inside run(): the credential enters the process at this
  // line and nowhere else, and run() takes an injected store precisely so a
  // caller can hand it a fake. A reachability probe belongs to the real one.
  await assertStoreReachable(store);

  const summary = await run({
    store,
    healthcheckUrl: process.env.HEALTHCHECK_URL,
    cap: process.env.BUNDLE_CAP ? Number(process.env.BUNDLE_CAP) : undefined,
  });

  console.log(formatSummary(summary));
  // Fail the Action on a fail-closed publish. The map is still serving the
  // previous archive, but a run that decided its own output was garbage is not
  // a success and must not be reported as one.
  if (!summary.published) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
