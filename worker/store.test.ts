import { afterEach, describe, expect, it, vi } from "vitest";
import { CDN_BASE } from "../lib/cdn.ts";
import { parseListPage, r2Store } from "./store.ts";

const CREDENTIALS = { accountId: "acct123", accessKeyId: "AKIAV", secretAccessKey: "secret" };

type MockResponse = { ok: boolean; status: number; text: () => Promise<string> };

function response(status: number, body = ""): MockResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function listPageXml(keys: string[], nextToken?: string): string {
  const contents = keys.map((key) => `<Contents><Key>${key}</Key></Contents>`).join("");
  const token = nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : "";
  return `<?xml version="1.0"?><ListBucketResult><Name>sonder</Name><Prefix>archives/</Prefix>${contents}${token}</ListBucketResult>`;
}

describe("r2Store", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("get() throws on 404 — callers depend on the throw meaning \"first run\"", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(404)) as unknown as typeof fetch;
    await expect(r2Store(CREDENTIALS).get("manifest.json")).rejects.toThrow();
  });

  it("get() returns the body text on success", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(200, "hello")) as unknown as typeof fetch;
    await expect(r2Store(CREDENTIALS).get("manifest.json")).resolves.toBe("hello");
  });

  it("list() follows NextContinuationToken across pages and returns keys, not URLs", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push(url);
      const token = new URL(url).searchParams.get("continuation-token");
      return response(200, token ? listPageXml(["archives/b.pmtiles"]) : listPageXml(["archives/a.pmtiles"], "tok1"));
    }) as unknown as typeof fetch;

    const keys = await r2Store(CREDENTIALS).list("archives/");
    expect(keys).toEqual(["archives/a.pmtiles", "archives/b.pmtiles"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("continuation-token=tok1");
    // Not URLs: no scheme/host leaked into a key.
    for (const key of keys) expect(key.startsWith("http")).toBe(false);
  });

  it("list() throws on 401/403 — it is the reachability probe", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(403, "Forbidden")) as unknown as typeof fetch;
    await expect(r2Store(CREDENTIALS).list("archives/")).rejects.toThrow();

    global.fetch = vi.fn().mockResolvedValue(response(401, "Unauthorized")) as unknown as typeof fetch;
    await expect(r2Store(CREDENTIALS).list("archives/")).rejects.toThrow();
  });

  it("putBinary() sends Cache-Control containing no-transform; putText() does not", async () => {
    const requests: Request[] = [];
    global.fetch = vi.fn(async (input: Request) => {
      requests.push(input);
      return response(200);
    }) as unknown as typeof fetch;

    const store = r2Store(CREDENTIALS);
    await store.putBinary("archives/stories-x.pmtiles", new Uint8Array([1, 2, 3]), 31_536_000);
    await store.putText("manifest.json", "{}", "application/json", 60);

    expect(requests).toHaveLength(2);
    expect(requests[0].headers.get("cache-control")).toContain("no-transform");
    expect(requests[1].headers.get("cache-control")).not.toContain("no-transform");
  });

  it("putBinary/putText return the public URL, not the S3 endpoint URL", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(200)) as unknown as typeof fetch;
    const store = r2Store(CREDENTIALS);

    const binaryUrl = await store.putBinary("archives/stories-x.pmtiles", new Uint8Array([1]), 60);
    const textUrl = await store.putText("manifest.json", "{}", "application/json", 60);

    expect(binaryUrl).toBe(`${CDN_BASE}/archives/stories-x.pmtiles`);
    expect(textUrl).toBe(`${CDN_BASE}/manifest.json`);
    expect(binaryUrl).not.toContain("r2.cloudflarestorage.com");
    expect(textUrl).not.toContain("r2.cloudflarestorage.com");
  });

  it("urlOf() composes the public base with no network call", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(r2Store(CREDENTIALS).urlOf("manifest.json")).toBe(`${CDN_BASE}/manifest.json`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remove() tolerates a 404 — a raced double-delete must not throw", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(404)) as unknown as typeof fetch;
    await expect(r2Store(CREDENTIALS).remove("state/run-1.jsonl")).resolves.toBeUndefined();
  });

  it("remove() throws on a real failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(500, "server error")) as unknown as typeof fetch;
    await expect(r2Store(CREDENTIALS).remove("state/run-1.jsonl")).rejects.toThrow();
  });
});

describe("parseListPage", () => {
  it("matches <Key> only — a naive parse would also pick up <Prefix>", () => {
    const xml =
      "<ListBucketResult><Prefix>archives/</Prefix><Contents><Key>archives/stories-a.pmtiles</Key></Contents></ListBucketResult>";
    expect(parseListPage(xml).keys).toEqual(["archives/stories-a.pmtiles"]);
  });

  it("returns nextToken only when the page was truncated", () => {
    const truncated = listPageXml(["a"], "tok");
    const last = listPageXml(["a"]);
    expect(parseListPage(truncated).nextToken).toBe("tok");
    expect(parseListPage(last).nextToken).toBeUndefined();
  });

  it("throws when the body is not a ListBucketResult — an <Error> doc or an HTML proxy page must not parse as zero keys", () => {
    expect(() => parseListPage("<Error><Code>AccessDenied</Code></Error>")).toThrow();
    expect(() => parseListPage("<html><body>502 Bad Gateway</body></html>")).toThrow();
  });

  it("unescapes XML entities in keys", () => {
    const xml = "<ListBucketResult><Contents><Key>archives/a&amp;b.json</Key></Contents></ListBucketResult>";
    expect(parseListPage(xml).keys).toEqual(["archives/a&b.json"]);
  });
});
