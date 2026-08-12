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
 * below so swapping in the SDK is one function. **Unverified against a live
 * token** — there is no `BLOB_READ_WRITE_TOKEN` in this repo yet, so the header
 * names and the delete endpoint are written from the documented surface and not
 * from a measured request. That is the one thing in this file §0 rule 7 has not
 * been applied to; check it against a real token before trusting a green run.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Manifest, StoryGroup } from "@/lib/types";
import type { ShardStore } from "./state";

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
  urlOf(key: string): Promise<string>;
};

const BLOB_API = "https://blob.vercel-storage.com";
const BLOB_API_VERSION = "7";

/**
 * Vercel Blob over its REST API.
 *
 * `x-add-random-suffix: 0` is load-bearing twice over: the manifest must live at
 * a stable key for the browser to find it, and the archive key must be the
 * content hash for immutability to mean anything. Blob's default is to append a
 * random suffix, which would silently break both.
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
      const response = await fetch(await this.urlOf(key));
      if (!response.ok) throw new Error(`blob get ${key}: HTTP ${response.status}`);
      return response.text();
    },

    async put(key, body) {
      // Shards are the state.ts path: JSONL, and never cached — a run reads them
      // back within minutes of writing them.
      await upload(key, body, "application/x-ndjson", 0);
    },

    async remove(key) {
      const url = await this.urlOf(key);
      const response = await fetch(`${BLOB_API}/delete`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ urls: [url] }),
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

    async urlOf(key) {
      const match = (await listBlobs(key)).find((blob) => blob.pathname === key);
      if (!match) throw new Error(`blob ${key} does not exist`);
      return match.url;
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
 * Ping the dead-man switch (§8).
 *
 * Best-effort by design: the run has already published successfully by the time
 * this is called, and failing it would turn a monitoring outage into a data
 * outage. A missed ping raises an alert, which is the correct outcome for
 * "something about this run is not right" — it just must not be the thing that
 * makes the next run's window shorter.
 */
export async function pingDeadMan(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}
