import { AwsClient } from "aws4fetch";
import { CDN_BASE } from "../src/lib/cdn.ts";
import type { ShardStore } from "./state.ts";

export type ArchiveStore = ShardStore & {
  putBinary(key: string, body: Uint8Array, maxAge: number): Promise<string>;
  putText(key: string, body: string, contentType: string, maxAge: number): Promise<string>;
  urlOf(key: string): string;
};

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
  nextToken?: string;
};

// Must match <Key> only (not top-level <Prefix>), verify <ListBucketResult>,
// and loop on NextContinuationToken. See docs/DESIGN.md#r2-traps.
export function parseListPage(xml: string): ListPage {
  if (!xml.includes("<ListBucketResult")) {
    throw new Error(
      "r2 list: response body is not a ListBucketResult — bad credentials, wrong bucket, or a proxy error page returned with 200"
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

// Explicit service/region — aws4fetch infers from hostname, but R2 host
// is not AWS, so inference fails as SignatureDoesNotMatch (looks like bad secret).
export function r2Store(credentials: R2Credentials): ArchiveStore {
  const endpoint = `https://${credentials.accountId}.r2.cloudflarestorage.com`;
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: "s3",
    region: "auto",
    // No retries: 20-min pipeline must fail fast; recovery is next run.
    retries: 0,
  });

  const objectUrl = (key: string) => `${endpoint}/${BUCKET}/${key}`;
  const urlOf = (key: string) => `${CDN_BASE}/${key}`;

  async function upload(
    key: string,
    body: BodyInit,
    contentType: string,
    cacheControl: string
  ): Promise<string> {
    const response = await client.fetch(objectUrl(key), {
      method: "PUT",
      headers: { "content-type": contentType, "cache-control": cacheControl },
      body,
    });
    if (!response.ok) {
      throw new Error(`r2 put ${key}: HTTP ${response.status} ${await response.text()}`);
    }
    return urlOf(key);
  }

  async function listPage(prefix: string, token?: string): Promise<ListPage> {
    const query = new URLSearchParams({ "list-type": "2", prefix });
    if (token) query.set("continuation-token", token);
    const response = await client.fetch(`${endpoint}/${BUCKET}?${query}`);
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
      if (!response.ok) throw new Error(`r2 get ${key}: HTTP ${response.status}`);
      return response.text();
    },

    async put(key, body) {
      await upload(key, body, "application/x-ndjson", "no-store");
    },

    async remove(key) {
      const response = await client.fetch(objectUrl(key), { method: "DELETE" });
      // 404 on DELETE is ok (double-delete can race); don't fail post-publish.
      if (!response.ok && response.status !== 404) {
        throw new Error(`r2 delete ${key}: HTTP ${response.status}`);
      }
    },

    putBinary(key, body, maxAge) {
      // no-transform: CDN compression corrupts range responses (maplibre/demotiles#35).
      return upload(
        key,
        new Blob([new Uint8Array(body)]),
        "application/octet-stream",
        `public, max-age=${maxAge}, immutable, no-transform`
      );
    },

    putText(key, body, contentType, maxAge) {
      // No no-transform: JSON is fetched whole, never by range.
      return upload(key, body, contentType, `public, max-age=${maxAge}`);
    },

    urlOf,
  };
}
