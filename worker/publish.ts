/**
 * Publication: Blob write, manifest, retention. Order is: upload the
 * content-hashed archive (immutable — a re-run of the same data is a
 * no-op), upload the region index and city shards, then flip the manifest
 * last, since it's the only mutation of a stable key and the map keeps
 * serving the previous archive, stale but correct, until it lands. Output
 * invariants (below) gate all of it — a run that "succeeds" but produces
 * garbage (e.g. a GDELT schema drift emptying `locations`) publishes
 * NOTHING and leaves the previous manifest in place. Retention prunes only
 * after the flip. Blob transport is the REST API over `fetch`, not
 * `@vercel/blob` — see `vercelBlobStore` for the traps that forced that.
 * See docs/DESIGN.md#operations.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { CityShard, Manifest, StoryGroup } from "../lib/types.ts";
import { stampToMs } from "./fetch.ts";
import type { RegionIndex } from "./regions.ts";
import type { ShardStore } from "./state.ts";

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

/**
 * What publish.ts needs on top of state.ts's ShardStore: binary bodies, a
 * per-key cache lifetime, and the public URL a key resolves to.
 */
export type ArchiveStore = ShardStore & {
  putBinary(key: string, body: Uint8Array, maxAge: number): Promise<string>;
  putText(key: string, body: string, contentType: string, maxAge: number): Promise<string>;
  /** Synchronous: a public blob's URL is derivable, never looked up. See publicBase. */
  urlOf(key: string): string;
};

const BLOB_API = "https://blob.vercel-storage.com";
const BLOB_API_VERSION = "7";

// A public store's URL host, derived from the token
// (vercel_blob_rw_<storeId>_<secret> -> https://<storeid>.public.blob...).
// Derived rather than looked up to avoid a billable `list` call on every
// get/remove. See docs/DESIGN.md#blob-traps.
function publicBase(token: string): string {
  const storeId = token.split("_")[3];
  if (!storeId) throw new Error("BLOB_READ_WRITE_TOKEN is not in the expected vercel_blob_rw_<id>_<secret> form");
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

/**
 * Vercel Blob over its REST API. The store must be created with PUBLIC
 * access (fixed at creation, not a code decision) — a private store serves
 * blobs through a Function instead of a direct URL, which breaks range
 * requests that pmtiles depends on. `x-add-random-suffix: 0` keeps keys
 * stable/content-addressed. `x-allow-overwrite: 1` is currently decorative
 * here (the REST layer permits overwrite regardless) but mandatory if this
 * is ever swapped for the `@vercel/blob` SDK, whose `put()` throws on an
 * existing pathname client-side unless `allowOverwrite: true` is passed.
 * The CDN can also serve a just-overwritten key stale for a few seconds
 * (bites concurrent smoke-testing, not the real 4-hourly cadence). Full
 * measurements: docs/DESIGN.md#blob-traps.
 */
export function vercelBlobStore(token: string): ArchiveStore {
  const headers = () => ({
    authorization: `Bearer ${token}`,
    "x-api-version": BLOB_API_VERSION,
  });

  async function upload(
    key: string,
    body: BodyInit,
    contentType: string,
    maxAge: number,
  ): Promise<string> {
    const response = await fetch(`${BLOB_API}/${key}`, {
      method: "PUT",
      headers: {
        ...headers(),
        "x-content-type": contentType,
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-cache-control-max-age": String(maxAge),
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`blob put ${key}: HTTP ${response.status} ${await response.text()}`);
    }
    return ((await response.json()) as { url: string }).url;
  }

  async function listBlobs(prefix: string): Promise<{ pathname: string; url: string }[]> {
    const out: { pathname: string; url: string }[] = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({ prefix, limit: "1000" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`${BLOB_API}?${query}`, { headers: headers() });
      if (!response.ok) throw new Error(`blob list ${prefix}: HTTP ${response.status}`);
      const page = (await response.json()) as {
        blobs: { pathname: string; url: string }[];
        cursor?: string;
        hasMore?: boolean;
      };
      out.push(...page.blobs);
      cursor = page.hasMore && page.cursor ? page.cursor : "";
    } while (cursor);
    return out;
  }

  return {
    async list(prefix) {
      return (await listBlobs(prefix)).map((blob) => blob.pathname);
    },

    async get(key) {
      const response = await fetch(this.urlOf(key));
      // A 404 is the ordinary "not written yet" case on a first run, and callers
      // (readHistory, run.ts's lastWatermark) treat a throw as exactly that.
      if (!response.ok) throw new Error(`blob get ${key}: HTTP ${response.status}`);
      return response.text();
    },

    async put(key, body) {
      // Shards are the state.ts path: JSONL, and never cached — a run reads them
      // back within minutes of writing them.
      await upload(key, body, "application/x-ndjson", 0);
    },

    async remove(key) {
      const response = await fetch(`${BLOB_API}/delete`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ urls: [this.urlOf(key)] }),
      });
      if (!response.ok) throw new Error(`blob delete ${key}: HTTP ${response.status}`);
    },

    putBinary(key, body, maxAge) {
      // Wrapped rather than passed raw: a Node Buffer is an ArrayBufferView, but
      // its `ArrayBufferLike` backing does not satisfy fetch's BodyInit under
      // this TypeScript. The re-wrap costs one copy of the archive and buys a
      // cast-free body; `body.buffer` is not usable directly because Buffer is
      // pool-allocated and may sit at a non-zero offset in a shared backing.
      return upload(key, new Blob([new Uint8Array(body)]), "application/octet-stream", maxAge);
    },

    putText(key, body, contentType, maxAge) {
      return upload(key, body, contentType, maxAge);
    },

    urlOf(key) {
      return `${publicBase(token)}/${key}`;
    },
  };
}

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

// Fail fast on a token that cannot reach the store. Every read elsewhere in
// this pipeline swallows its own errors (a first-run "not written yet" is
// legitimate), which otherwise leaves a bad credential invisible until the
// first write, several steps later, with a stack trace that names nothing
// about the token. One authenticated `list` at startup catches it in one
// line; kept to a single call since `list` is a billed "advanced operation".
export async function assertStoreReachable(store: ArchiveStore): Promise<void> {
  try {
    await store.list(ARCHIVE_PREFIX);
  } catch (cause) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN cannot reach the Blob store. The token is the whole " +
        "of the store's identity — `vercel_blob_rw_<storeId>_<secret>` — so this is " +
        "a stale, truncated or quoted token rather than a permissions setting. " +
        "GitHub stores a secret literally: surrounding quotes copied out of " +
        ".env.local become part of the value, and `node --env-file` strips them " +
        "locally, so the same token can work here and fail in Actions.",
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
