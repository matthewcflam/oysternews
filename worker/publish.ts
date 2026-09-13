import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CDN_BASE } from "../src/lib/cdn.ts";
import type { CityShard, Manifest, StoryGroup } from "../src/lib/types.ts";
import { stampToMs } from "./fetch.ts";
import type { RegionIndex } from "./regions.ts";
import type { ArchiveStore } from "./store.ts";

export const MANIFEST_KEY = "manifest.json";
export const ARCHIVE_DIR = "archives/";
export const ARCHIVE_PREFIX = `${ARCHIVE_DIR}stories-`;
export const REGIONS_PREFIX = `${ARCHIVE_DIR}regions-`;
export const CITIES_PREFIX = `${ARCHIVE_DIR}cities-`;
export const HISTORY_KEY = "state/publish-history.json";

export const REGIONS_VERSION = 2;

const CITY_UPLOAD_CONCURRENCY = 8;

// Manifest unstable, archives immutable.
export const MANIFEST_MAX_AGE = 60;
export const ARCHIVE_MAX_AGE = 31_536_000;

export const KEEP_ARCHIVES = 3;

const HISTORY_LIMIT = 24;

// Count band uses absolute counts, not ratios (ratios can wedge: "fail-closed
// becomes fail-forever" when history cannot advance). Measured bounds; re-derive
// against fresh volume if either GDELT scale or grouping key changes.
export const COUNT_BAND_MIN = 2_000;
export const COUNT_BAND_MAX = 60_000;
export const MIN_COUNTRIES = 15;
export const MIN_TITLE_RATE = 0.95;
export const MIN_GROUPS = 1;

// After 24h blocked, stand down count band so one stale constant cannot wedge
// the publish. MIN_GROUPS/MIN_COUNTRIES/MIN_TITLE_RATE stay armed.
export const BAND_RELAX_AFTER_MS = 24 * 60 * 60 * 1000;

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

export function checkInvariants(
  stats: PublishStats,
  /** Milliseconds since the last successful publish. Past BAND_RELAX_AFTER_MS the band stands down. */
  staleFor = 0
): string[] {
  const violations: string[] = [];

  if (stats.groups < MIN_GROUPS) {
    violations.push(`no groups to publish (${stats.groups})`);
    // Everything below divides by or reasons about a non-empty run.
    return violations;
  }

  if (staleFor < BAND_RELAX_AFTER_MS) {
    if (stats.groups < COUNT_BAND_MIN || stats.groups > COUNT_BAND_MAX) {
      violations.push(`group count ${stats.groups} outside [${COUNT_BAND_MIN}, ${COUNT_BAND_MAX}]`);
    }
  }

  if (stats.countries < MIN_COUNTRIES) {
    violations.push(`only ${stats.countries} distinct countries, floor is ${MIN_COUNTRIES}`);
  }

  const titleRate = stats.titled / stats.groups;
  if (titleRate < MIN_TITLE_RATE) {
    violations.push(
      `${(titleRate * 100).toFixed(1)}% of groups have a title, floor is ${MIN_TITLE_RATE * 100}%`
    );
  }

  return violations;
}

// 8 hex chars (32 bits) is enough: collision within retention window
// (3 deep) is negligible, and short keys keep logs readable.
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

export function archiveKey(hash: string): string {
  return `${ARCHIVE_PREFIX}${hash}.pmtiles`;
}

export function archivesToPrune(
  stored: string[],
  history: HistoryEntry[],
  keep = KEEP_ARCHIVES
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
      key.startsWith(ARCHIVE_DIR) && !live.has(key) && !liveDirs.some((dir) => key.startsWith(dir))
  );
}

export function nextHistory(
  history: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT
): HistoryEntry[] {
  return [...history.filter((h) => h.archive !== entry.archive), entry].slice(-limit);
}

export type { ArchiveStore };

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
  | {
      published: true;
      manifest: Manifest;
      stats: PublishStats;
      pruned: number;
      bandRelaxed: boolean;
    }
  | { published: false; violations: string[]; stats: PublishStats };

export function staleness(history: HistoryEntry[], now: Date): number {
  const stamps = history.map((entry) => stampToMs(entry.stamp)).filter((ms) => !Number.isNaN(ms));
  if (stamps.length === 0) return Number.POSITIVE_INFINITY;
  return now.getTime() - Math.max(...stamps);
}

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
      { cause }
    );
  }
}

// S3 endpoint answering ≠ CDN_BASE reachable. This probe must not fail
// on HTTP 404 (empty on first run); only on DNS/TLS/connection errors.
export async function assertPublicHostReachable(
  base: string = CDN_BASE,
  // Injected so the test can drive it without a network.
  doFetch: typeof globalThis.fetch = globalThis.fetch
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
      { cause }
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
async function pooled<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  const { store, archivePath, groups, watermark } = input;
  const now = input.now ?? new Date();

  const stats = statsOf(groups);
  const history = await readHistory(store);

  const staleFor = staleness(history, now);
  const bandRelaxed = history.length > 0 && staleFor >= BAND_RELAX_AFTER_MS;

  const violations = checkInvariants(stats, bandRelaxed ? staleFor : 0);
  if (violations.length > 0) return { published: false, violations, stats };

  const bytes = await readFile(archivePath);
  const key = archiveKey(contentHash(bytes));
  const url = await store.putBinary(key, bytes, ARCHIVE_MAX_AGE);

  const regionsBody = `${JSON.stringify(input.regions)}\n`;
  const regionsKey = `${REGIONS_PREFIX}${contentHash(Buffer.from(regionsBody))}.json`;
  const regionsUrl = await store.putText(
    regionsKey,
    regionsBody,
    "application/json",
    ARCHIVE_MAX_AGE
  );

  const cities = input.cities ?? {};
  const countryCodes = Object.keys(cities).sort();
  let citiesDir: string | undefined;
  let citiesBase: string | undefined;

  if (countryCodes.length > 0) {
    const citiesHash = contentHash(
      Buffer.from(countryCodes.map((code) => `${code}:${JSON.stringify(cities[code])}`).join("\n"))
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

  await store.putText(
    MANIFEST_KEY,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "application/json",
    MANIFEST_MAX_AGE
  );

  const updated = nextHistory(history, {
    stamp: watermark,
    archive: key,
    regions: regionsKey,
    ...(citiesDir ? { cities: citiesDir } : {}),
    groups: stats.groups,
  });
  await store.putText(HISTORY_KEY, `${JSON.stringify(updated)}\n`, "application/json", 0);

  const stored = await store.list(ARCHIVE_DIR);
  const stale = archivesToPrune(stored, updated);
  for (const old of stale) await store.remove(old);

  return { published: true, manifest, stats, pruned: stale.length, bandRelaxed };
}

export async function pingHealthcheck(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}
