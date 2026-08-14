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
import { stampToMs } from "./fetch.ts";
import type { RegionIndex } from "./regions.ts";
import type { ShardStore } from "./state.ts";

export const MANIFEST_KEY = "manifest.json";
/** Everything content-hashed and retained together. Retention sweeps this whole directory. */
export const ARCHIVE_DIR = "archives/";
export const ARCHIVE_PREFIX = `${ARCHIVE_DIR}stories-`;
export const REGIONS_PREFIX = `${ARCHIVE_DIR}regions-`;
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
 * The count band: absolute group counts, not a ratio against past runs.
 *
 * **It was self-referential until 2026-08-14 and that is what broke it, twice in
 * one day.** The band used to be `[0.4×, 2.5×]` of the trailing median of up to
 * 24 past runs, which fails for a reason no tuning fixes: a refused run does not
 * append to history (`publish` returns before the history write), so the median
 * that refused a run never moves and the next run is refused identically. Fail-
 * closed becomes fail-forever. It fired on the *lower* bound at 09:11 UTC, when a
 * median of two 1-bundle smoke runs (846, 1467) refused a real 6,718-group run,
 * and on the *upper* bound from 17:13 UTC, when a median of 7,620 — taken while
 * the 24-hour pool was still filling — refused runs of ~20,500 and up. Same
 * defect both times: **a median is a lagging statistic and the pool has a trend
 * in it**, so the reference set describes a past that is not comparable to now.
 *
 * Absolute bounds have no feedback loop at all. They also arm on the very first
 * run, where the old band was inert for want of history — the exact moment a
 * bootstrap mistake ships unguarded.
 *
 * **Where the numbers come from — both ends are measured, not chosen.**
 *
 * ```
 *   1,467   a 1-bundle smoke run (2026-08-12, BUNDLE_CAP=1)
 *   2,000   FLOOR
 *  40,700   steady state: §4's distinct city stories after dedup, per day
 *  60,000   CEILING              = 1.47× steady state
 *  75,000   grouping stops merging entirely: ~112,500 records/day (§4)
 *                                 × ~67% placed (measured: 1411 rows -> 949)
 * ```
 *
 * The floor sits above a single-bundle run and 20× below steady state, so it
 * catches a collapse and an accidental `BUNDLE_CAP` without ever false-firing.
 * The ceiling sits between steady state and total grouping failure, which is the
 * only interval where an upper bound is informative: **above 75,000 it would
 * stop catching the one failure it exists for**, and below ~50,000 it would
 * refuse ordinary days.
 *
 * **These are calibration constants with a shelf life.** They are correct for
 * GDELT's volume as measured on 2026-08-12/13 and for the current grouping key.
 * Anything that changes either — a looser grouping key, GDELT raising its crawl
 * rate, widening the window past 24 hours — invalidates them. Re-derive from a
 * fresh §4 measurement rather than nudging the ceiling up until runs pass.
 */
export const COUNT_BAND_MIN = 2_000;
export const COUNT_BAND_MAX = 60_000;
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

/**
 * How long the count band may block publication before it stops being a guard
 * and starts being the outage. 8 hours — §8's 2× cadence, the same threshold the
 * UI's stale notice uses.
 *
 * **What this guards against changed on 2026-08-14, and it is still needed.** It
 * was built for a self-poisoning median: a refused run does not append to
 * history, so the median that refused it never moved and the next run was refused
 * identically, for ever. Absolute bounds cannot poison themselves, so that
 * failure mode is gone. What replaces it is a **stale constant** — COUNT_BAND_MAX
 * is calibrated against GDELT volume as measured, and if real volume outgrows it
 * then every run is refused for the same reason with no self-correction at all.
 * That is the same wedge with a slower fuse, and this valve is the only thing
 * between it and a dead map. Past 8 hours the band stands down, the map keeps
 * moving, and the WARN is the signal to go re-derive the constants.
 *
 * **Only the count band relaxes.** MIN_GROUPS, the country floor and the title
 * rate stay armed unconditionally, and they are the ones that actually catch
 * garbage — a placement collapse shows up as too few countries, a parse break as
 * missing titles. The band is the fuzziest of the four and the only one carrying
 * a number that can go out of date without anything in the pipeline noticing.
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

/**
 * Every reason this run must not publish, as human-readable lines.
 *
 * Returns all of them rather than the first: a run that fails the count band
 * *and* the country floor is a different diagnosis from one that fails only the
 * band, and the Action log is the only place anyone will read it.
 *
 * **This reads nothing but the run in front of it.** It took no `history`
 * argument until 2026-08-13 and takes none again as of 2026-08-14 — the band's
 * bounds are constants now, and passing history here would imply the guard still
 * derives something from past runs. It does not, and that is the whole fix.
 */
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
  for (const entry of history.slice(-keep)) {
    live.add(entry.archive);
    // An archive and its region index are one publication and are retained as
    // one. Sweeping the whole directory rather than the stories prefix is what
    // makes adding a second content-hashed artefact safe: a new prefix nobody
    // updated the pruner for would otherwise accumulate for ever.
    if (entry.regions) live.add(entry.regions);
  }
  return stored.filter((key) => key.startsWith(ARCHIVE_DIR) && !live.has(key));
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
 *
 * **`get` reads through the CDN, and the CDN will serve a key you just
 * overwrote.** Measured 2026-08-13: a fresh PUT to `state/publish-history.json`
 * read back as the *previous* body, with `X-Vercel-Cache: HIT` and `Age: 6`,
 * under `cache-control: public, max-age=0, s-maxage=0`. Nothing in the pipeline
 * re-reads a key it wrote in the same run, and at a 4-hourly cadence the cache
 * is long expired, so this is not a live bug — but two runs minutes apart (what
 * smoke-testing looks like) means the second can read the first's pre-write
 * manifest and history. Verify a hand-written key with a cache-busting query.
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
  /** §2.3's region panel index, published beside the archive. */
  regions: RegionIndex;
  /** Newest GKG bundle included, YYYYMMDDHHMMSS. */
  watermark: string;
  /** Injected so a test can pin it; the run passes `new Date()`. */
  now?: Date;
};

export type PublishResult =
  | { published: true; manifest: Manifest; stats: PublishStats; pruned: number; bandRelaxed: boolean }
  | { published: false; violations: string[]; stats: PublishStats };

/**
 * How long since the last successful publish, from the history's own stamps.
 *
 * The stamp is the watermark — the newest GKG bundle that run included — not the
 * wall clock it ran at. For "has publication been blocked for too long" the two
 * are within one run of each other, and using the watermark keeps this readable
 * from the history alone, with no extra field to backfill on an existing store.
 *
 * `Infinity` on an empty or unparseable history, which reads as "nothing has
 * published, so nothing is protecting anything". **Callers must not hand that
 * straight to the relax valve** — an empty history would stand the band down on
 * the first run of a fresh store. `publish` gates on `history.length > 0` for
 * exactly this reason.
 */
export function staleness(history: HistoryEntry[], now: Date): number {
  const stamps = history.map((entry) => stampToMs(entry.stamp)).filter((ms) => !Number.isNaN(ms));
  if (stamps.length === 0) return Number.POSITIVE_INFINITY;
  return now.getTime() - Math.max(...stamps);
}

/**
 * Fail fast on a token that cannot reach the store.
 *
 * **Every read in this pipeline swallows its own errors**, and each one has a
 * good reason to: `lastWatermark` and `readHistory` both treat a failure as "not
 * written yet", which is the correct reading on a first run and must not block
 * publication. The cost is that a credential failure is invisible until the
 * first *write* — measured 2026-08-13, when a stale `BLOB_READ_WRITE_TOKEN` in
 * the Action secrets sailed past the manifest read, made the run believe it had
 * no watermark and refetch the whole window, and then died four steps later at
 * `appendShards` with a bare 403 from inside `state.ts`. Nothing in that stack
 * trace named the token.
 *
 * One authenticated `list` at startup turns that into one line. It is billed as
 * an "advanced operation", so this must stay at one call per run — which is why
 * it is a named assertion called once from the entry point, and not a check
 * folded into `get`.
 */
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

  // `history.length > 0` is load-bearing, not defensive. `staleness` returns
  // Infinity on an empty history, so without it the very first run of a fresh
  // store would relax the band and publish any count at all — which is exactly
  // the bootstrap moment a mistake most wants to ship through. The valve means
  // "we have published before and it has been too long since", and with nothing
  // published there is nothing being blocked. The old BAND_MIN_HISTORY covered
  // this by accident; now it is the condition itself.
  const staleFor = staleness(history, now);
  const bandRelaxed = history.length > 0 && staleFor >= BAND_RELAX_AFTER_MS;

  const violations = checkInvariants(stats, bandRelaxed ? staleFor : 0);
  if (violations.length > 0) return { published: false, violations, stats };

  const bytes = await readFile(archivePath);
  const key = archiveKey(contentHash(bytes));
  const url = await store.putBinary(key, bytes, ARCHIVE_MAX_AGE);

  // Before the manifest, like the archive, and for the same reason: the flip is
  // the only thing the browser sees, so everything it will point at has to
  // already exist. A panel that 404s is a broken feature on a working map.
  const regionsBody = `${JSON.stringify(input.regions)}\n`;
  const regionsKey = `${REGIONS_PREFIX}${contentHash(Buffer.from(regionsBody))}.json`;
  const regionsUrl = await store.putText(
    regionsKey,
    regionsBody,
    "application/json",
    ARCHIVE_MAX_AGE,
  );

  const manifest: Manifest = {
    archive: key,
    url,
    regionsUrl,
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
    groups: stats.groups,
  });
  await store.putText(HISTORY_KEY, `${JSON.stringify(updated)}\n`, "application/json", 0);

  const stored = await store.list(ARCHIVE_PREFIX);
  const stale = archivesToPrune(stored, updated);
  for (const old of stale) await store.remove(old);

  return { published: true, manifest, stats, pruned: stale.length, bandRelaxed };
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
