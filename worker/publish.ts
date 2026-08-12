/**
 * Publication. I/O — Blob write, manifest, retention (HANDOFF.md §3.3).
 *
 * §7 names the failure path here as one of three critical gaps: *"a partial
 * publish points the manifest at a half-written archive and breaks the map for
 * everyone."* Two properties make that unreachable rather than unlikely:
 *
 * 1. **The archive is content-hashed and written before the manifest.** Its key
 *    is derived from its own bytes, so it is immutable and a re-run of the same
 *    data is a no-op. A failed upload leaves an orphan nobody references; it
 *    never leaves a live pointer to a truncated file.
 * 2. **The manifest flip is the only mutation of a stable key**, and it is the
 *    last write. Until it lands the map keeps serving the previous archive,
 *    which is stale but correct — the one failure mode this project prefers.
 *
 * Retention prunes AFTER the flip (§5), for the same reason: the archive the
 * manifest is about to stop pointing at has to survive until it is unreferenced.
 * Without pruning at all, Hobby storage fills in 48-72 hours.
 *
 * **Output invariants gate everything above.** §8 lists "run succeeds, publishes
 * garbage" as a distinct failure from "run throws", and it is the one no
 * exception will catch: a GDELT schema drift that silently empties `locations`
 * produces a perfectly valid 40-feature archive. On violation this publishes
 * NOTHING — not a smaller archive, not a warning banner — and leaves the
 * previous manifest in place.
 *
 * **The Blob transport is the REST API over `fetch`, not `@vercel/blob`** (§0
 * rule 5: ask before adding dependencies). It is confined to `vercelBlobStore`
 * below, which carries the measurements taken against the live store and the two
 * traps that came out of them.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Manifest, StoryGroup } from "../lib/types.ts";
import type { ShardStore } from "./state.ts";

export const MANIFEST_KEY = "manifest.json";
export const ARCHIVE_PREFIX = "archives/stories-";
export const HISTORY_KEY = "state/publish-history.json";

/** The manifest is a stable key and must not be cached long; the archives are immutable. */
export const MANIFEST_MAX_AGE = 60;
export const ARCHIVE_MAX_AGE = 31_536_000;

/** Keep the last 3 archives, prune the rest after the manifest flips (§5). */
export const KEEP_ARCHIVES = 3;

/** Enough history to survive a few missed runs without unbounded growth. */
const HISTORY_LIMIT = 24;

// --- Output invariants (§5, §8) ---------------------------------------------

/**
 * The band is deliberately loose. §4 measures GDELT volume swinging ~2× by time
 * of day; a rolling 24-hour window smooths that away, but a recovery run after
 * an outage genuinely does publish a thin window and must not be blocked from
 * self-healing. These thresholds are set to catch a collapse, not a wobble.
 */
export const COUNT_BAND_LOW = 0.4;
export const COUNT_BAND_HIGH = 2.5;
/** No band until there is something to compare against — the first runs bootstrap it. */
export const BAND_MIN_HISTORY = 3;
/**
 * A live 24-hour window spans well over a hundred countries (§3.4 observed 168
 * distinct FIPS codes in the audit alone), so this floor only fires when
 * placement has broken globally rather than drifted.
 */
export const MIN_COUNTRIES = 15;
/** §4: titles are present on 99.7% of records. Below 95% something upstream is wrong. */
export const MIN_TITLE_RATE = 0.95;
/** A window that produced nothing is a failure even with no history to compare to. */
export const MIN_GROUPS = 1;

export type PublishStats = {
  groups: number;
  countries: number;
  tier1Groups: number;
  titled: number;
};

export type HistoryEntry = {
  stamp: string;
  archive: string;
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

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Every reason this run must not publish, as human-readable lines.
 *
 * Returns all of them rather than the first: a run that fails the count band
 * *and* the country floor is a different diagnosis from one that fails only the
 * band, and the Action log is the only place anyone will read it.
 */
export function checkInvariants(stats: PublishStats, history: HistoryEntry[]): string[] {
  const violations: string[] = [];

  if (stats.groups < MIN_GROUPS) {
    violations.push(`no groups to publish (${stats.groups})`);
    // Everything below divides by or reasons about a non-empty run.
    return violations;
  }

  if (history.length >= BAND_MIN_HISTORY) {
    const mid = median(history.map((entry) => entry.groups));
    const low = Math.floor(mid * COUNT_BAND_LOW);
    const high = Math.ceil(mid * COUNT_BAND_HIGH);
    if (stats.groups < low || stats.groups > high) {
      violations.push(
        `group count ${stats.groups} outside [${low}, ${high}] around trailing median ${mid}`,
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

/**
 * Which archive keys to delete, given everything currently stored and the
 * history *after* this run's entry has been appended.
 *
 * Driven by the history list rather than by upload timestamps: the history is
 * the record of what the manifest has actually pointed at, and an archive that
 * was uploaded but never published (a run that failed its invariants after the
 * upload) should be pruned immediately, not aged out.
 */
export function archivesToPrune(
  stored: string[],
  history: HistoryEntry[],
  keep = KEEP_ARCHIVES,
): string[] {
  const live = new Set<string>();
  for (const entry of history.slice(-keep)) live.add(entry.archive);
  return stored.filter((key) => key.startsWith(ARCHIVE_PREFIX) && !live.has(key));
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

/**
 * A public store's URL host, derived from the token.
 *
 * `BLOB_READ_WRITE_TOKEN` is `vercel_blob_rw_<storeId>_<secret>`, and a public
 * blob is served at `https://<storeid>.public.blob.vercel-storage.com/<pathname>`
 * with the id lowercased. Verified against the live store on 2026-08-12: the
 * derived URL is byte-identical to the one `put` returns.
 *
 * Deriving it rather than looking it up removes a `list` call from every `get`
 * and every `remove`. That is not just tidiness — Vercel bills `list` as an
 * "advanced operation", so the old shape paid a billable request to discover a
 * URL it could have computed, on every read, forever.
 */
function publicBase(token: string): string {
  const storeId = token.split("_")[3];
  if (!storeId) throw new Error("BLOB_READ_WRITE_TOKEN is not in the expected vercel_blob_rw_<id>_<secret> form");
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

/**
 * Vercel Blob over its REST API.
 *
 * **The store must be created with PUBLIC access.** A private store delivers
 * blobs through a Function instead of by direct URL, which would break §3.2's
 * range-request architecture outright — the browser fetches byte ranges from the
 * PMTiles archive itself. Access mode cannot be changed after a store is
 * created, so this is a store-creation decision, not a code one. A private store
 * fails here with `Cannot use public access on a private store` (measured
 * 2026-08-12).
 *
 * Two headers are load-bearing, both learned the same way:
 *
 * - **`x-add-random-suffix: 0`** — the manifest must live at a stable key for the
 *   browser to find it, and the archive key must be its content hash for
 *   immutability to mean anything. Blob's default appends a random suffix, which
 *   would silently break both.
 * - **`x-allow-overwrite: 1`** — belt and braces, and the reason is a trap for
 *   whoever swaps in the SDK. Vercel documents `put()` as throwing on a pathname
 *   that already exists, but **the REST layer permits the overwrite regardless**
 *   (measured 2026-08-12: a bare PUT over an existing key returned 200). The
 *   guard lives in `@vercel/blob`, client-side. So this header is currently
 *   decorative *here* and mandatory *there*: **anyone replacing this function
 *   with the SDK must pass `allowOverwrite: true`**, or every run after the first
 *   fails at the manifest write, having already uploaded the archive — the §7
 *   gap-1 shape. It is kept rather than dropped in case Vercel moves the check
 *   server-side, which would otherwise break this silently.
 *
 * Measured against the live store on 2026-08-12, all passing: stable keys, text
 * and binary round-trips, `cache-control` honoring `x-cache-control-max-age`,
 * overwrite, delete, and — the ones §3.2's architecture rests on — `206` range
 * responses with a correct `content-range` and `access-control-allow-origin: *`.
 * Note that Vercel caps the CDN's own `s-maxage` at 300s on the archives even
 * though the browser gets `max-age=31536000`; immaterial for content-hashed
 * keys, which never change under a given URL.
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
  /** Newest GKG bundle included, YYYYMMDDHHMMSS. */
  watermark: string;
  /** Injected so a test can pin it; the run passes `new Date()`. */
  now?: Date;
};

export type PublishResult =
  | { published: true; manifest: Manifest; stats: PublishStats; pruned: number }
  | { published: false; violations: string[]; stats: PublishStats };

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

/**
 * Validate, upload, flip, prune. In that order, and the order is the design.
 *
 * Note that the invariants run against the groups the archive was built FROM,
 * before a byte is uploaded: a rejected run costs nothing and leaves no orphan.
 */
export async function publish(input: PublishInput): Promise<PublishResult> {
  const { store, archivePath, groups, watermark } = input;
  const now = input.now ?? new Date();

  const stats = statsOf(groups);
  const history = await readHistory(store);

  const violations = checkInvariants(stats, history);
  if (violations.length > 0) return { published: false, violations, stats };

  const bytes = await readFile(archivePath);
  const key = archiveKey(contentHash(bytes));
  const url = await store.putBinary(key, bytes, ARCHIVE_MAX_AGE);

  const manifest: Manifest = {
    archive: key,
    url,
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

  const updated = nextHistory(history, { stamp: watermark, archive: key, groups: stats.groups });
  await store.putText(HISTORY_KEY, `${JSON.stringify(updated)}\n`, "application/json", 0);

  const stored = await store.list(ARCHIVE_PREFIX);
  const stale = archivesToPrune(stored, updated);
  for (const old of stale) await store.remove(old);

  return { published: true, manifest, stats, pruned: stale.length };
}

/**
 * Ping the dead-man switch (§8). `run.ts` passes `process.env.HEALTHCHECK_URL`,
 * a healthchecks.io check on a 4-hour period with a 4-hour grace — so silence
 * alerts at 2× cadence, which is the rule §8 actually specifies.
 *
 * Best-effort by design: the run has already published successfully by the time
 * this is called, and failing it would turn a monitoring outage into a data
 * outage. A missed ping raises an alert, which is the correct outcome for
 * "something about this run is not right" — it just must not be the thing that
 * makes the next run's window shorter.
 */
export async function pingHealthcheck(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}
