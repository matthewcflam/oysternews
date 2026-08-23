/**
 * Cloudflare R2 over its S3-compatible API, signed with `aws4fetch`. Reads
 * and deletes go to the authenticated S3 endpoint rather than the public
 * CDN URL — the Vercel Blob implementation this replaced had no
 * authenticated GET and had to fetch the public URL for `get`/`remove`,
 * which measurably read back a just-overwritten key stale (see
 * docs/DESIGN.md#r2-traps). Routing reads through the S3 endpoint
 * eliminates that entire class of bug. `urlOf()` still returns the public
 * `CDN_BASE` URL, because that value is what goes into the manifest for
 * the browser.
 */

import { AwsClient } from "aws4fetch";
import { CDN_BASE } from "../lib/cdn.ts";
import type { ShardStore } from "./state.ts";

/**
 * What publish.ts needs on top of state.ts's ShardStore: binary bodies, a
 * per-key cache lifetime, and the public URL a key resolves to. Lives here
 * (moved from publish.ts) because store.ts is the natural home for
 * anything shaped by the store's transport; re-exported from publish.ts so
 * existing imports keep working.
 */
export type ArchiveStore = ShardStore & {
  putBinary(key: string, body: Uint8Array, maxAge: number): Promise<string>;
  putText(key: string, body: string, contentType: string, maxAge: number): Promise<string>;
  /** Synchronous: a public R2 URL is derivable, never looked up. */
  urlOf(key: string): string;
};

/**
 * Bucket name is hardcoded rather than an env var: it is not secret, and
 * `lib/manifest.ts`'s `CDN_BASE` precedent is that a constant in the repo
 * cannot drift from the deploy the way a value in two different dashboards
 * (GitHub Actions, Vercel) can.
 */
const BUCKET = "sonder";

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]);
}

export type ListPage = {
  keys: string[];
  /** Present iff the page was truncated — see the function comment below. */
  nextToken?: string;
};

/**
 * A narrow, dependency-free extraction of `<Key>` and
 * `<NextContinuationToken>` from a `ListObjectsV2` response, rather than an
 * XML library — see docs/DESIGN.md#r2-traps.
 *
 * Matches `<Key>` only. The response body also carries a top-level
 * `<Prefix>archives/</Prefix>` alongside the `<Key>` elements; a looser
 * match would inject that into the key list, where `archivesToPrune`
 * passes it straight to `store.remove`.
 *
 * Also guards that the body is a `ListBucketResult` at all — an `<Error>`
 * document or an HTML proxy page returned with a 200 would otherwise parse
 * as "zero keys stored", which would let `assertStoreReachable` pass while
 * retention silently prunes nothing, forever.
 *
 * Skips `<IsTruncated>` entirely: S3 emits `NextContinuationToken` if and
 * only if the page is truncated, so looping on a non-empty token is
 * equivalent, one regex shorter, and cannot wedge on a truncated page that
 * omits the token.
 *
 * The five XML entities are unescaped even though the key namespace this
 * project writes is `[A-Za-z0-9/_.-]` and never needs it — nothing in code
 * enforces that, and unescaping stops the invariant being load-bearing.
 */
export function parseListPage(xml: string): ListPage {
  if (!xml.includes("<ListBucketResult")) {
    throw new Error(
      "r2 list: response body is not a ListBucketResult — bad credentials, wrong bucket, or a proxy error page returned with 200",
    );
  }
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => unescapeXml(match[1]));
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
  return { keys, nextToken: token ? unescapeXml(token[1]) : undefined };
}

export type R2Credentials = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * R2 over the S3 API. `service: "s3"` and `region: "auto"` are set
 * explicitly — aws4fetch infers both from the hostname, and
 * `*.r2.cloudflarestorage.com` is not an AWS host, so the inferred scope is
 * rejected as `SignatureDoesNotMatch`, which reads like a bad secret rather
 * than a config error.
 */
export function r2Store(credentials: R2Credentials): ArchiveStore {
  const endpoint = `https://${credentials.accountId}.r2.cloudflarestorage.com`;
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: "s3",
    region: "auto",
    // aws4fetch retries 5xx/429 by default (10x, exponential backoff) — too
    // slow and too silent for a 20-minute pipeline run to wait through. A
    // failure here should surface immediately; recovery is the next
    // scheduled run, not a request-level retry storm.
    retries: 0,
  });

  const objectUrl = (key: string) => `${endpoint}/${BUCKET}/${key}`;
  const urlOf = (key: string) => `${CDN_BASE}/${key}`;

  async function upload(
    key: string,
    body: BodyInit,
    contentType: string,
    cacheControl: string,
  ): Promise<string> {
    const response = await client.fetch(objectUrl(key), {
      method: "PUT",
      headers: { "content-type": contentType, "cache-control": cacheControl },
      body,
    });
    if (!response.ok) {
      throw new Error(`r2 put ${key}: HTTP ${response.status} ${await response.text()}`);
    }
    // The public URL, not the S3 endpoint URL — that is what the manifest and
    // the browser need, and the S3 endpoint 403s for an unsigned request.
    return urlOf(key);
  }

  async function listPage(prefix: string, token?: string): Promise<ListPage> {
    const query = new URLSearchParams({ "list-type": "2", prefix });
    if (token) query.set("continuation-token", token);
    const response = await client.fetch(`${endpoint}/${BUCKET}?${query}`);
    // The reachability probe (assertStoreReachable) depends on this throwing
    // on 401/403 rather than returning an empty/garbage page.
    if (!response.ok) {
      throw new Error(`r2 list ${prefix}: HTTP ${response.status} ${await response.text()}`);
    }
    return parseListPage(await response.text());
  }

  return {
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await listPage(prefix, token);
        keys.push(...page.keys);
        token = page.nextToken;
      } while (token);
      return keys;
    },

    async get(key) {
      const response = await client.fetch(objectUrl(key));
      // A 404 is the ordinary "not written yet" case on a first run, and
      // callers (readHistory, run.ts's lastWatermark) treat a throw as exactly
      // that.
      if (!response.ok) throw new Error(`r2 get ${key}: HTTP ${response.status}`);
      return response.text();
    },

    async put(key, body) {
      // Shards are the state.ts path: JSONL, and never cached — a run reads
      // them back within minutes of writing them.
      await upload(key, body, "application/x-ndjson", "no-store");
    },

    async remove(key) {
      const response = await client.fetch(objectUrl(key), { method: "DELETE" });
      // S3 DELETE of a missing key returns 204, but a raced double-delete must
      // not throw regardless: retention and pruneShards both loop deletes, and
      // retention runs after the manifest flip — a throw there would fail a
      // run that has already successfully published.
      if (!response.ok && response.status !== 404) {
        throw new Error(`r2 delete ${key}: HTTP ${response.status}`);
      }
    },

    putBinary(key, body, maxAge) {
      // Cloudflare's CDN compresses objects by default, which corrupts range
      // responses (wrong Content-Range total, weak ETags, truncated bodies —
      // the documented cause of maplibre/demotiles#35). `no-transform` from
      // the origin is the fix, and only the archive is ever range-requested.
      return upload(
        key,
        new Blob([new Uint8Array(body)]),
        "application/octet-stream",
        `public, max-age=${maxAge}, immutable, no-transform`,
      );
    },

    putText(key, body, contentType, maxAge) {
      // JSON artefacts do NOT get no-transform — they are fetched whole, never
      // by range, and compression is a win there. If the city shards become a
      // range-addressed pack, they must move to no-transform too.
      return upload(key, body, contentType, `public, max-age=${maxAge}`);
    },

    urlOf,
  };
}
