/**
 * Fetching GKG bundles. I/O (HANDOFF.md §3.3).
 *
 * §3.5: fetch every 15-minute bundle since the last successful watermark,
 * **capped at 12**. A failed run self-heals on the next one — it simply asks for
 * a longer span — and the cap is what stops a week-long outage from turning the
 * recovery run into a 30-minute download that times out the Action.
 *
 * Two constraints that are not preferences:
 *
 * - **HTTP, not HTTPS.** `https://data.gdeltproject.org` fails certificate
 *   verification (§4). This is a public, unauthenticated bulk feed and the URLs
 *   are constructed here rather than taken from input.
 * - **The English feed is `lastupdate.txt`, not `lastupdate-translation.txt`**
 *   (§2.6). That single choice is the entire English-only mechanism. It is
 *   approximately English, not exactly, and the About page says so.
 *
 * Raw GKG is the only access path that works — GEO 2.0 returns 404 on GDELT's
 * own documented example URLs and DOC 2.0 is non-deterministically rate-limited
 * (§4). There is no fallback, which is why parse.ts's canary is `>= 27`.
 */

import { inflateRawSync } from "node:zlib";

export const BASE = "http://data.gdeltproject.org/gdeltv2";
export const MAX_BUNDLES = 12;
const USER_AGENT = "sonder/0.1 (portfolio project; contact matthewcflam@gmail.com)";

export type Bundle = {
  /** YYYYMMDDHHMMSS, the bundle's own stamp. */
  stamp: string;
  csv: string;
  bytes: number;
};

/**
 * Minimal single-entry ZIP reader.
 *
 * A GKG bundle is one deflated CSV, so the whole of the format needed is: find
 * the end-of-central-directory record, follow it to the local file header,
 * inflate what follows. Thirty lines against a dependency, for a layout that has
 * not changed since 1989 (§0 rule 5).
 */
export function unzipSingleEntry(archive: Buffer): Buffer {
  const EOCD = 0x06054b50;
  let eocd = -1;
  // The EOCD sits at the end, followed only by an optional comment (<= 64 KB).
  for (let i = archive.length - 22; i >= 0 && i >= archive.length - 22 - 0xffff; i--) {
    if (archive.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");

  const centralDir = archive.readUInt32LE(eocd + 16);
  if (archive.readUInt32LE(centralDir) !== 0x02014b50) {
    throw new Error("zip central directory header is malformed");
  }

  const method = archive.readUInt16LE(centralDir + 10);
  const compressedSize = archive.readUInt32LE(centralDir + 20);
  const localHeader = archive.readUInt32LE(centralDir + 42);
  if (archive.readUInt32LE(localHeader) !== 0x04034b50) {
    throw new Error("zip local file header is malformed");
  }

  const nameLength = archive.readUInt16LE(localHeader + 26);
  const extraLength = archive.readUInt16LE(localHeader + 28);
  const start = localHeader + 30 + nameLength + extraLength;
  const body = archive.subarray(start, start + compressedSize);

  if (method === 0) return body;
  if (method === 8) return inflateRawSync(body);
  throw new Error(`unsupported zip compression method ${method}`);
}

/** The newest bundle GDELT has finished writing. */
export async function newestStamp(): Promise<string> {
  const response = await fetch(`${BASE}/lastupdate.txt`, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`lastupdate.txt: HTTP ${response.status}`);
  const line = (await response.text())
    .trim()
    .split("\n")
    .find((l) => l.includes(".gkg.csv.zip"));
  const stamp = line && /(\d{14})/.exec(line)?.[1];
  if (!stamp) throw new Error("lastupdate.txt carried no GKG bundle stamp");
  return stamp;
}

/**
 * A YYYYMMDDHHMMSS stamp as epoch milliseconds, UTC.
 *
 * `NaN` on anything that is not fourteen digits, so callers can tell a malformed
 * stamp from a real instant rather than silently getting 1970.
 */
export function stampToMs(stamp: string): number {
  if (!/^\d{14}$/.test(stamp)) return Number.NaN;
  return Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14)),
  );
}

/** Step a YYYYMMDDHHMMSS stamp by whole minutes. */
export function shiftStamp(stamp: string, minutes: number): string {
  const moved = new Date(stampToMs(stamp) + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${moved.getUTCFullYear()}${pad(moved.getUTCMonth() + 1)}${pad(moved.getUTCDate())}` +
    `${pad(moved.getUTCHours())}${pad(moved.getUTCMinutes())}${pad(moved.getUTCSeconds())}`
  );
}

/**
 * Every 15-minute stamp after `watermark` up to and including `newest`, oldest
 * first, capped at MAX_BUNDLES.
 *
 * The cap keeps the NEWEST bundles when it bites: falling behind should leave
 * the map current with a gap in its history, not up to date with yesterday.
 */
export function stampsToFetch(watermark: string, newest: string, cap = MAX_BUNDLES): string[] {
  if (!/^\d{14}$/.test(newest)) return [];
  const stamps: string[] = [];
  let cursor = newest;
  while (stamps.length < cap && cursor > watermark) {
    stamps.push(cursor);
    cursor = shiftStamp(cursor, -15);
  }
  return stamps.reverse();
}

/**
 * Download one bundle.
 *
 * A missing bundle is not fatal. GDELT does occasionally skip a slot, and the
 * caller counts misses rather than failing the run over one 15-minute gap in a
 * 24-hour window.
 */
export async function fetchBundle(stamp: string): Promise<Bundle | null> {
  const response = await fetch(`${BASE}/${stamp}.gkg.csv.zip`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) return null;

  const archive = Buffer.from(await response.arrayBuffer());
  return {
    stamp,
    csv: unzipSingleEntry(archive).toString("utf8"),
    bytes: archive.length,
  };
}
