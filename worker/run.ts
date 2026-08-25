/**
 * Orchestration only. Every decision lives in one of the modules this
 * calls; what's here is the ORDER (fetch -> parse -> filter -> place ->
 * state -> group -> rank -> budget -> tiles -> publish -> prune -> ping).
 * See docs/DESIGN.md#pipeline for why each step sits where it does. The
 * watermark comes from the published manifest, not local state, so a run
 * that fails its invariants does not advance it. A run that publishes
 * nothing exits non-zero (fails the Action) and skips the healthcheck ping
 * (fires the dead-man switch) — two independent alarms on one event. See
 * docs/DESIGN.md#failure.
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
  assertPublicHostReachable,
  assertStoreReachable,
  pingHealthcheck,
  publish,
} from "./publish.ts";
import { rankGroups } from "./rank.ts";
import { buildRegionIndex, indexStats } from "./regions.ts";
import { buildCityIndex, cityIndexStats } from "./cities.ts";
import { continentIdFor } from "../lib/continents.ts";
import { type RefData, assertUsable, loadRefData, sourceCountry } from "./refdata.ts";
import { r2Store } from "./store.ts";
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

// Article + Placement -> the record that gets stored and grouped. Pure,
// exported: the one place source country, tier-1 membership, and FIPS
// validity are applied to a story — getting tier-1 wrong here would
// silently disable it downstream (the comparator still runs, just never on
// a tier-1 group).
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
    image: article.image,
    themes: article.themes,
    lat: location.lat,
    lon: location.lon,
    kind: placement.kind,
    countryCode: location.countryCode,
    regionId: placement.kind === "CONTAINER" ? placement.regionId : "",
    // Every placement, not just containers — see PlacedArticle.adm1. A country
    // location carries no adm1Code at all, which is correctly "".
    adm1: location.adm1Code,
    placeName: location.name,
    sourceCountry: sourceCountry(article.domain, data),
    tier1: data.tier1.has(article.domain),
  };
}

// A FIPS code the crosswalk doesn't know and hasn't marked as a known
// non-country. Logged loudly and counted — the degraded behavior (a plain
// pin) looks completely normal on the map otherwise.
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
  /** The region panel index: regions covered and total rows. */
  regions: number;
  regionRows: number;
  /** Per-country city shards: countries with at least one clustered city, and clusters total. */
  cityShards: number;
  cityRecords: number;
  published: boolean;
  /** The count band stood down because publication had been blocked past 2× cadence. */
  bandRelaxed: boolean;
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
    // GDELT skips slots. A miss is counted, never fatal.
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

  // Continent id from a group's own country FIPS, via the crosswalk's
  // `continent` column. "" for anything the crosswalk cannot place —
  // `buildRegionIndex` files nothing under an empty key.
  const continentOf = (fips: string): string =>
    continentIdFor(data.countries.get(fips)?.continent) ?? "";

  // Built from the budgeted groups, which is every group in the window — the
  // panel deliberately reaches stories the z12 ceiling drops (see docs/DESIGN.md#tiles-budget).
  const regions = buildRegionIndex(budgeted, undefined, continentOf);
  const regionStats = indexStats(regions);
  const cities = buildCityIndex(budgeted);
  const cityStats = cityIndexStats(cities);

  // --- tiles ---------------------------------------------------------------
  await buildTiles(budgeted, countryTop, WORK_DIR, ARCHIVE_PATH);

  // --- publish -------------------------------------------------------------
  const result = await publish({
    store,
    archivePath: ARCHIVE_PATH,
    groups: budgeted,
    regions,
    cities,
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
    // Named, not spread: indexStats returns `rows`, and this object already has
    // a `rows` meaning parsed GKG rows. Spreading silently overwrote it.
    regions: regionStats.regions,
    regionRows: regionStats.rows,
    cityShards: cityStats.shards,
    cityRecords: cityStats.cities,
    published: result.published,
    bandRelaxed: result.published ? result.bandRelaxed : false,
    violations: result.published ? [] : result.violations,
    archive: result.published ? result.manifest.archive : "",
    prunedArchives: result.published ? result.pruned : 0,
    prunedShards,
    pinged,
  };
}

/**
 * The run summary — the only interface docs/DESIGN.md#failure's monitoring
 * has to most failure modes, so it prints unconditionally, including on
 * the failure path.
 */
export function formatSummary(summary: RunSummary): string {
  const lines = [
    `watermark    ${summary.watermark || "(none)"} -> ${summary.bundlesFetched} of ${summary.bundlesRequested} bundles (${summary.bundlesMissing} missing)`,
    `parse        ${summary.rows} rows, ${summary.shortRows} short, ${summary.noTitle} untitled`,
    `filter       ${summary.blocked} blocklisted, ${summary.noLocation} unplaceable`,
    `place        ${summary.placed} placed, ${summary.dropped} dropped`,
    `pool         ${summary.poolSize} articles from ${summary.shardsRead} shards (${summary.duplicatesDropped} dupes, ${summary.badLines} bad lines)`,
    `groups       ${summary.groups} groups, ${summary.tier1Groups} tier-1, ${summary.countryTop} country-top, ${summary.overflow} overflow`,
    `panel        ${summary.regions} regions indexed, ${summary.regionRows} rows`,
    `cities       ${summary.cityShards} country shards, ${summary.cityRecords} clustered cities`,
  ];

  // A schema change shows up here first, as a nonzero short-row count.
  if (summary.shortRows > 0) {
    lines.push(`WARN         ${summary.shortRows} rows failed the schema canary — GDELT may have changed`);
  }
  // Tier-1 count going to zero is the silent-degradation case — nothing
  // else fails when it happens, which is why it's called out here.
  if (summary.groups > 0 && summary.tier1Groups === 0) {
    lines.push("WARN         no tier-1 groups — ranking has degraded to plain salience");
  }
  for (const [code, count] of summary.unknownFips) {
    lines.push(`WARN         unknown FIPS code ${code} on ${count} stories — needs a data/fips-overrides entry`);
  }

  // Publishing past the band is the deliberate escape from a wedge, but it is
  // still a run that published output the guard called implausible. It must never
  // look like an ordinary success in the log.
  //
  // Since 2026-08-14 the band is two absolute constants, so this line has a
  // second job: it is the ONLY signal that those constants have gone stale.
  // Nothing self-corrects any more — if real volume outgrows COUNT_BAND_MAX,
  // every run is refused until a human re-derives it. Hence the instruction.
  if (summary.bandRelaxed) {
    lines.push(
      "WARN         count band stood down — blocked past 2× cadence.",
      "             Re-derive COUNT_BAND_MIN/MAX against a fresh volume",
      "             measurement; do not nudge them until runs pass.",
    );
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
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set");
  }
  const store = r2Store({ accountId, accessKeyId, secretAccessKey });

  // Here rather than inside run(): the credential enters the process at this
  // line and nowhere else, and run() takes an injected store precisely so a
  // caller can hand it a fake. A reachability probe belongs to the real one.
  await assertStoreReachable(store);
  // The S3 endpoint answering says nothing about the host the browser reads.
  await assertPublicHostReachable();

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
