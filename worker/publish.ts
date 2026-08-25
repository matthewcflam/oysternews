/**
 * Publication: R2 write, manifest, retention. Order is: upload the
 * content-hashed archive (immutable — a re-run of the same data is a
 * no-op), upload the region index and city shards, then flip the manifest
 * last, since it's the only mutation of a stable key and the map keeps
 * serving the previous archive, stale but correct, until it lands. Output
 * invariants (below) gate all of it — a run that "succeeds" but produces
 * garbage (e.g. a GDELT schema drift emptying `locations`) publishes
 * NOTHING and leaves the previous manifest in place. Retention prunes only
 * after the flip. Store transport is `r2Store` in `store.ts`, over R2's
 * S3-compatible API — see that file's header for the traps that shaped it.
 * See docs/DESIGN.md#operations.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CDN_BASE } from "../lib/cdn.ts";
import type { CityShard, Manifest, StoryGroup } from "../lib/types.ts";
import { stampToMs } from "./fetch.ts";
import type { RegionIndex } from "./regions.ts";
import type { ArchiveStore } from "./store.ts";

export const MANIFEST_KEY = "manifest.json";
/** Everything content-hashed and retained together. Retention sweeps this whole directory. */
export const ARCHIVE_DIR = "archives/";
export const ARCHIVE_PREFIX = `${ARCHIVE_DIR}stories-`;
export const REGIONS_PREFIX = `${ARCHIVE_DIR}regions-`;
/** One directory per run, one shard per country beneath it — see `publish`. */
export const CITIES_PREFIX = `${ARCHIVE_DIR}cities-`;
export const HISTORY_KEY = "state/publish-history.json";

/** Regions-index format version. Bump when a new key namespace (e.g. `CONT:*`) is added, so an old manifest's index reads as `unavailable` rather than confidently empty. See docs/DESIGN.md#the-manifest-and-regions_version. */
export const REGIONS_VERSION = 2;

/** Shard uploads run concurrently in pools this size — 121 sequential PUTs would add 12-36s to a run. */
const CITY_UPLOAD_CONCURRENCY = 8;

/** The manifest is a stable key and must not be cached long; the archives are immutable. */
export const MANIFEST_MAX_AGE = 60;
export const ARCHIVE_MAX_AGE = 31_536_000;

/** Keep the last 3 archives, prune the rest after the manifest flips. */
export const KEEP_ARCHIVES = 3;

/** Enough history to survive a few missed runs without unbounded growth. */
const HISTORY_LIMIT = 24;

// --- Output invariants --------------------------------------------------------

/**
 * The count band: absolute group counts, not a ratio against past runs (a
 * trailing-median band failed twice in one day — "fail-closed becomes
 * fail-forever" when a refused run can't move the history that refused
 * it). Calibration ladder, each rung measured or derived:
 *
 * ```
 *   1,467   a 1-bundle smoke run (2026-08-12, BUNDLE_CAP=1)
 *   2,000   FLOOR
 *  40,700   steady state: distinct city stories after dedup, per day
 *  60,000   CEILING              = 1.47× steady state
 *  75,000   grouping stops merging entirely: ~112,500 records/day
 *                                 × ~67% placed (measured: 1411 rows -> 949)
 * ```
 *
 * These are calibration constants with a shelf life — correct for GDELT's
 * measured volume and the current grouping key; re-derive rather than nudge
 * if either changes. See docs/DESIGN.md#the-count-band.
 */
export const COUNT_BAND_MIN = 2_000;
export const COUNT_BAND_MAX = 60_000;
/** A live window spans well over a hundred countries, so this floor only fires when placement has broken globally rather than drifted. */
export const MIN_COUNTRIES = 15;
/** Titles are present on ~99.7% of records normally. Below 95% something upstream is wrong. */
export const MIN_TITLE_RATE = 0.95;
/** A window that produced nothing is a failure even with no history to compare to. */
export const MIN_GROUPS = 1;

/**
 * How long the count band may block publication before it stands down (8h,
 * the 2x monitoring cadence). Guards against COUNT_BAND_MAX going stale as
 * real volume grows — without this valve a calibration constant falling
 * behind reality would refuse every run with no self-correction. Only the
 * count band relaxes; MIN_GROUPS, the country floor, and the title rate
 * stay armed unconditionally since they catch real garbage rather than a
 * volume swing. See docs/DESIGN.md#the-count-band.
 */
export const BAND_RELAX_AFTER_MS = 8 * 60 * 60 * 1000;

export type PublishStats = {
  groups: number;
  countries: number;
  tier1Groups: number;
  titled: number;
};

export type HistoryEntry = {
  stamp: string;
  archive: string;
  /**
   * The region index published with that archive. Optional: entries written
   * before the index existed have none, and retention must read those as "this
   * run referenced no index" rather than crashing or pruning a live key.
   */
  regions?: string;
  /**
   * The city-shard directory published with that archive (e.g.
   * `archives/cities-a1b2c3d4/`), or absent for a run with no city groups.
   * A directory, not 121 keys — `archivesToPrune` keeps every key that
   * starts with a live entry's prefix.
   */
  cities?: string;
  groups: number;
};

export function statsOf(groups: StoryGroup[]): PublishStats {
  return {
    groups: groups.length,
    countries: new Set(groups.map((g) => g.countryCode).filter(Boolean)).size,
    tier1Groups: groups.filter((g) => g.tier1Fresh).length,
    titled: groups.filter((g) => g.title.trim() !== "").length,
  };
}

// Every reason this run must not publish, as human-readable lines. Returns
// all of them, not just the first, so a run failing both the count band and
// the country floor gets a distinguishable diagnosis in the Action log.
// Reads nothing but the run in front of it — no history argument, since the
// band's bounds are constants now.
export function checkInvariants(
  stats: PublishStats,
  /** Milliseconds since the last successful publish. Past BAND_RELAX_AFTER_MS the band stands down. */
  staleFor = 0,
): string[] {
  const violations: string[] = [];

  if (stats.groups < MIN_GROUPS) {
    violations.push(`no groups to publish (${stats.groups})`);
    // Everything below divides by or reasons about a non-empty run.
    return violations;
  }

  if (staleFor < BAND_RELAX_AFTER_MS) {
    if (stats.groups < COUNT_BAND_MIN || stats.groups > COUNT_BAND_MAX) {
      violations.push(
        `group count ${stats.groups} outside [${COUNT_BAND_MIN}, ${COUNT_BAND_MAX}]`,
      );
    }
  }

  if (stats.countries < MIN_COUNTRIES) {
    violations.push(`only ${stats.countries} distinct countries, floor is ${MIN_COUNTRIES}`);
  }

  const titleRate = stats.titled / stats.groups;
  if (titleRate < MIN_TITLE_RATE) {
    violations.push(
      `${(titleRate * 100).toFixed(1)}% of groups have a title, floor is ${MIN_TITLE_RATE * 100}%`,
    );
  }

  return violations;
}

// --- Content hashing and retention ------------------------------------------

/**
 * The archive key, derived from the archive's bytes.
 *
 * Eight hex characters is 32 bits. The collision that matters is not birthday
 * across all archives ever, but two *different* archives colliding inside the
 * three-deep retention window, which 32 bits makes irrelevant. Short keys keep
 * the manifest readable in a log line.
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

export function archiveKey(hash: string): string {
  return `${ARCHIVE_PREFIX}${hash}.pmtiles`;
}

// Which archive keys to delete, given everything stored and the history
// *after* this run's entry was appended. Driven by history, not upload
// timestamps: an archive uploaded but never published (invariants failed
// after upload) should prune immediately, not age out.
export function archivesToPrune(
  stored: string[],
  history: HistoryEntry[],
  keep = KEEP_ARCHIVES,
): string[] {
  const live = new Set<string>();
  const liveDirs: string[] = [];
  for (const entry of history.slice(-keep)) {
    live.add(entry.archive);
    // An archive and its region index are one publication, retained as one.
    if (entry.regions) live.add(entry.regions);
    // City shards publish as a directory of ~121 keys under one
    // content-hashed prefix, not a single key — every key beneath
    // entry.cities is live, or a run's own shards would look unreferenced
    // the moment they finish uploading and get pruned before a browser
    // ever fetches one.
    if (entry.cities) liveDirs.push(entry.cities);
  }
  return stored.filter(
    (key) =>
      key.startsWith(ARCHIVE_DIR) && !live.has(key) && !liveDirs.some((dir) => key.startsWith(dir)),
  );
}

export function nextHistory(
  history: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
): HistoryEntry[] {
  return [...history.filter((h) => h.archive !== entry.archive), entry].slice(-limit);
}

// --- The store ---------------------------------------------------------------

// Re-exported so existing imports of ArchiveStore from publish.ts keep
// working — the type itself, and its implementation (`r2Store`), now live
// in store.ts, which is the natural home for anything shaped by the
// store's transport.
export type { ArchiveStore };

// --- Publishing ---------------------------------------------------------------

export type PublishInput = {
  store: ArchiveStore;
  /** Path to the archive tiles.ts produced. */
  archivePath: string;
  groups: StoryGroup[];
  /** The region panel index, published beside the archive. docs/DESIGN.md#regions */
  regions: RegionIndex;
  /** Per-country city shards. Absent or empty publishes no city artefact and leaves `manifest.citiesBase` unset. */
  cities?: Record<string, CityShard>;
  /** Newest GKG bundle included, YYYYMMDDHHMMSS. */
  watermark: string;
  /** Injected so a test can pin it; the run passes `new Date()`. */
  now?: Date;
};

export type PublishResult =
  | { published: true; manifest: Manifest; stats: PublishStats; pruned: number; bandRelaxed: boolean }
  | { published: false; violations: string[]; stats: PublishStats };

// How long since the last successful publish, using each entry's watermark
// (not wall clock) so this stays readable from history alone. Returns
// Infinity on an empty/unparseable history — callers must not hand that
// straight to the relax valve; publish() gates on history.length > 0.
export function staleness(history: HistoryEntry[], now: Date): number {
  const stamps = history.map((entry) => stampToMs(entry.stamp)).filter((ms) => !Number.isNaN(ms));
  if (stamps.length === 0) return Number.POSITIVE_INFINITY;
  return now.getTime() - Math.max(...stamps);
}

// Fail fast on credentials that cannot reach the store. Every read elsewhere
// in this pipeline swallows its own errors (a first-run "not written yet" is
// legitimate), which otherwise leaves a bad credential invisible until the
// first write, several steps later, with a stack trace that names nothing
// about the credential. One authenticated `list` at startup catches it in
// one line; kept to a single call since `list` (ListObjectsV2) is a billed
// R2 Class A operation.
export async function assertStoreReachable(store: ArchiveStore): Promise<void> {
  try {
    await store.list(ARCHIVE_PREFIX);
  } catch (cause) {
    throw new Error(
      "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY cannot reach the R2 " +
        "store. A wrong account id signs against the wrong endpoint host; a wrong " +
        "key pair fails signature verification — aws4fetch reports both as " +
        "SignatureDoesNotMatch, which reads like a config error rather than a bad " +
        "secret, so check the three env vars in that order. GitHub stores a secret " +
        "literally: surrounding quotes copied out of .env.local become part of the " +
        "value, and `node --env-file` strips them locally, so a credential can work " +
        "here and fail in Actions. Note this check cannot catch a read-only token — " +
        "it passes on `list` and the run then dies later inside appendShards.",
      { cause },
    );
  }
}

/**
 * Fail fast when the public host cannot serve what we are about to publish.
 *
 * `assertStoreReachable` proves the *S3 endpoint* answers, which is a
 * different host from the one the browser reads. The manifest's `url`,
 * `regionsUrl` and `citiesBase` are all built from `CDN_BASE`, so a run can
 * write every object successfully, flip the manifest, exit 0 — and still
 * leave the map blank, because nothing ever checked that `CDN_BASE` resolves.
 * That is not hypothetical: on 2026-08-24 a scheduled run published a
 * manifest pointing at a custom domain whose zone had not been delegated yet,
 * and the failure was invisible for two and a half hours.
 *
 * A 404 is a **pass**. The bucket is empty on a first run, and any HTTP
 * response at all proves DNS, TLS and routing work — which is the whole
 * question. Only a transport-level throw (NXDOMAIN, TLS failure, refused
 * connection) fails, and that is exactly the shape a wrong or undelegated
 * `CDN_BASE` takes. One Class B operation against a 10M/month allowance.
 */
export async function assertPublicHostReachable(
  base: string = CDN_BASE,
  // Injected so the test can drive it without a network.
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  try {
    await doFetch(`${base}/${MANIFEST_KEY}`, { method: "HEAD" });
  } catch (cause) {
    throw new Error(
      `The public host ${base} could not be reached, so a manifest published ` +
        "now would point every browser at a dead origin while the run itself " +
        "reported success. CDN_BASE comes from lib/cdn.ts, overridden by " +
        "R2_PUBLIC_BASE. Check that the R2 bucket has this custom domain " +
        "connected and that its zone is Active in Cloudflare — an undelegated " +
        "or unconnected domain fails here as a DNS or TLS error, not an HTTP " +
        "status. Any HTTP response, 404 included, passes this check.",
      { cause },
    );
  }
}

export async function readHistory(store: ArchiveStore): Promise<HistoryEntry[]> {
  try {
    const parsed = JSON.parse(await store.get(HISTORY_KEY)) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // Absent on the first run, and a corrupt history must not block publication
    // — it only widens the band it would otherwise have narrowed.
    return [];
  }
}

// Run worker(item) over items with at most `limit` in flight. A plain pool
// is enough for a shard upload (one round trip, nothing else); a rejection
// propagates through Promise.all, failing the run before the manifest flip.
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// Validate, upload, flip, prune, in that order. Invariants run against the
// pre-upload groups, so a rejected run costs nothing and leaves no orphan.
export async function publish(input: PublishInput): Promise<PublishResult> {
  const { store, archivePath, groups, watermark } = input;
  const now = input.now ?? new Date();

  const stats = statsOf(groups);
  const history = await readHistory(store);

  // history.length > 0 is load-bearing: staleness() returns Infinity on an
  // empty history, so without this the very first run of a fresh store
  // would relax the band and publish any count at all.
  const staleFor = staleness(history, now);
  const bandRelaxed = history.length > 0 && staleFor >= BAND_RELAX_AFTER_MS;

  const violations = checkInvariants(stats, bandRelaxed ? staleFor : 0);
  if (violations.length > 0) return { published: false, violations, stats };

  const bytes = await readFile(archivePath);
  const key = archiveKey(contentHash(bytes));
  const url = await store.putBinary(key, bytes, ARCHIVE_MAX_AGE);

  // Uploaded before the manifest flip, like the archive: everything the
  // flip will point at must already exist.
  const regionsBody = `${JSON.stringify(input.regions)}\n`;
  const regionsKey = `${REGIONS_PREFIX}${contentHash(Buffer.from(regionsBody))}.json`;
  const regionsUrl = await store.putText(
    regionsKey,
    regionsBody,
    "application/json",
    ARCHIVE_MAX_AGE,
  );

  // City shards, uploaded before the manifest for the same reason. One
  // content-hashed directory covers all of them so retention tracks one
  // prefix instead of ~121 keys.
  const cities = input.cities ?? {};
  const countryCodes = Object.keys(cities).sort();
  let citiesDir: string | undefined;
  let citiesBase: string | undefined;

  if (countryCodes.length > 0) {
    const citiesHash = contentHash(
      Buffer.from(countryCodes.map((code) => `${code}:${JSON.stringify(cities[code])}`).join("\n")),
    );
    citiesDir = `${CITIES_PREFIX}${citiesHash}/`;

    await pooled(countryCodes, CITY_UPLOAD_CONCURRENCY, async (code) => {
      const body = `${JSON.stringify(cities[code])}\n`;
      await store.putText(`${citiesDir}${code}.json`, body, "application/json", ARCHIVE_MAX_AGE);
    });
    citiesBase = store.urlOf(citiesDir);
  }

  const manifest: Manifest = {
    archive: key,
    url,
    regionsUrl,
    regionsVersion: REGIONS_VERSION,
    ...(citiesBase ? { citiesBase } : {}),
    generatedAt: now.toISOString(),
    watermark,
    stats: {
      groups: stats.groups,
      countries: stats.countries,
      tier1Groups: stats.tier1Groups,
    },
  };

  // The flip. Everything before this point is invisible to the browser.
  await store.putText(
    MANIFEST_KEY,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "application/json",
    MANIFEST_MAX_AGE,
  );

  const updated = nextHistory(history, {
    stamp: watermark,
    archive: key,
    regions: regionsKey,
    ...(citiesDir ? { cities: citiesDir } : {}),
    groups: stats.groups,
  });
  await store.putText(HISTORY_KEY, `${JSON.stringify(updated)}\n`, "application/json", 0);

  // Must list the whole ARCHIVE_DIR, not a narrower prefix — a filter can
  // only delete what the listing returned, and a too-narrow listing here
  // once left every regions-*.json un-pruned for months with no visible
  // symptom. See docs/DESIGN.md#publication-order.
  const stored = await store.list(ARCHIVE_DIR);
  const stale = archivesToPrune(stored, updated);
  for (const old of stale) await store.remove(old);

  return { published: true, manifest, stats, pruned: stale.length, bandRelaxed };
}

// Ping the dead-man switch (healthchecks.io, 4h period + 4h grace = the 2x
// cadence alert rule, docs/DESIGN.md#failure). Best-effort: the run has
// already published by the time this is called, so a failed ping must not
// turn a monitoring outage into a data outage.
export async function pingHealthcheck(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}
