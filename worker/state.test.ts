import { describe, expect, it } from "vitest";
import type { PlacedArticle } from "@/lib/types";
import {
  RUN_PREFIX,
  TIER1_PREFIX,
  type ShardStore,
  appendShards,
  dedupe,
  fromJsonl,
  isLive,
  pruneShards,
  readPool,
  stampOf,
} from "./state";

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
const HOUR = 3600 * 1000;

function gkg(hoursAgo: number): string {
  const d = new Date(NOW - hoursAgo * HOUR);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function article(patch: Partial<PlacedArticle> = {}): PlacedArticle {
  return {
    date: gkg(1),
    domain: "a.com",
    url: "https://a.com/1",
    title: "t",
    themes: [],
    lat: 1,
    lon: 2,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    placeName: "p",
    sourceCountry: "US",
    tier1: false,
    ...patch,
  };
}

/** In-memory store, which is all the tests need and all the interface promises. */
function memoryStore(seed: Record<string, string> = {}): ShardStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    async get(key) {
      return data.get(key) ?? "";
    },
    async put(key, body) {
      data.set(key, body);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

describe("expiry by filename", () => {
  it("reads the stamp out of the key", () => {
    expect(stampOf("state/run-20260812050000.jsonl")).toBe("20260812050000");
    expect(stampOf("state/nonsense.jsonl")).toBe("");
  });

  it("expires the general family at 24 hours and tier-1 at 48", () => {
    // §3.5: two families, two expiries. Tier-1 is 1.05% of the feed, so the
    // second family is nearly free; keeping 48h of ALL shards would have
    // doubled state storage for no benefit.
    expect(isLive(`${RUN_PREFIX}${gkg(23)}.jsonl`, NOW)).toBe(true);
    expect(isLive(`${RUN_PREFIX}${gkg(25)}.jsonl`, NOW)).toBe(false);
    expect(isLive(`${TIER1_PREFIX}${gkg(25)}.jsonl`, NOW)).toBe(true);
    expect(isLive(`${TIER1_PREFIX}${gkg(49)}.jsonl`, NOW)).toBe(false);
  });

  it("keeps a shard stamped in the future rather than deleting it", () => {
    // Clock skew should not silently shrink the window.
    expect(isLive(`${RUN_PREFIX}${gkg(-2)}.jsonl`, NOW)).toBe(true);
  });

  it("treats an unparseable key as expired rather than keeping it forever", () => {
    expect(isLive("state/run-garbage.jsonl", NOW)).toBe(false);
  });
});

describe("dedupe by (domain, url)", () => {
  it("path 5: a group in both shard families counts each article once", () => {
    const both = [article(), article()];
    expect(dedupe(both).length).toBe(1);
  });

  it("keeps the same url under a different publisher", () => {
    const two = [article({ domain: "a.com" }), article({ domain: "b.com" })];
    expect(dedupe(two).length).toBe(2);
  });
});

describe("jsonl", () => {
  it("survives a truncated final line instead of losing the window", () => {
    const text = `${JSON.stringify(article())}\n{"date":"2026`;
    const { articles, bad } = fromJsonl(text);
    expect(articles.length).toBe(1);
    expect(bad).toBe(1);
  });

  it("ignores blank lines", () => {
    expect(fromJsonl("\n\n").articles).toEqual([]);
  });
});

describe("the pool", () => {
  it("unions both families, drops expired shards and dedupes the overlap", () => {
    const shared = article({ domain: "bbc.co.uk", url: "https://bbc.co.uk/1", tier1: true });
    const store = memoryStore({
      [`${RUN_PREFIX}${gkg(2)}.jsonl`]: JSON.stringify(shared),
      [`${TIER1_PREFIX}${gkg(2)}.jsonl`]: JSON.stringify(shared),
      [`${TIER1_PREFIX}${gkg(30)}.jsonl`]: JSON.stringify(
        article({ domain: "cnn.com", url: "https://cnn.com/1", tier1: true }),
      ),
      [`${RUN_PREFIX}${gkg(30)}.jsonl`]: JSON.stringify(
        article({ domain: "old.com", url: "https://old.com/1" }),
      ),
    });

    return readPool(store, NOW).then((pool) => {
      const urls = pool.articles.map((a) => a.url).sort();
      // The 30h tier-1 shard survives; the 30h general shard does not.
      expect(urls).toEqual(["https://bbc.co.uk/1", "https://cnn.com/1"]);
      expect(pool.duplicatesDropped).toBe(1);
      expect(pool.shardsExpired).toBe(1);
    });
  });

  it("path 2: a tier-1 story survives after the general window has moved past it", () => {
    // Its own articles are 30 hours old, so the 24-hour family no longer holds
    // them. Without the second family the story would silently drop off the map
    // after one day and the §2.5 comparator would still "work".
    const store = memoryStore({
      [`${TIER1_PREFIX}${gkg(30)}.jsonl`]: JSON.stringify(
        article({ domain: "bbc.co.uk", url: "https://bbc.co.uk/x", tier1: true, date: gkg(30) }),
      ),
    });
    return readPool(store, NOW).then((pool) => {
      expect(pool.articles.length).toBe(1);
    });
  });
});

describe("writing and pruning", () => {
  it("writes both families, with tier-1 filtered into the second", async () => {
    const store = memoryStore();
    const result = await appendShards(store, "20260812050000", [
      article({ domain: "local.com", url: "https://local.com/1" }),
      article({ domain: "bbc.co.uk", url: "https://bbc.co.uk/1", tier1: true }),
    ]);

    expect(result.tier1Written).toBe(1);
    expect(fromJsonl(store.data.get(`${RUN_PREFIX}20260812050000.jsonl`)!).articles.length).toBe(2);
    expect(fromJsonl(store.data.get(`${TIER1_PREFIX}20260812050000.jsonl`)!).articles.length).toBe(1);
  });

  it("writes an empty tier-1 shard rather than omitting it", async () => {
    // §8 watches the tier-1 count for the silent-degradation case. A missing
    // file and a run that never happened must not look the same.
    const store = memoryStore();
    await appendShards(store, "20260812050000", [article()]);
    expect(store.data.has(`${TIER1_PREFIX}20260812050000.jsonl`)).toBe(true);
  });

  it("prunes only the expired shards", async () => {
    const store = memoryStore({
      [`${RUN_PREFIX}${gkg(2)}.jsonl`]: "",
      [`${RUN_PREFIX}${gkg(40)}.jsonl`]: "",
      [`${TIER1_PREFIX}${gkg(40)}.jsonl`]: "",
      [`${TIER1_PREFIX}${gkg(60)}.jsonl`]: "",
    });
    const pruned = await pruneShards(store, NOW);
    expect(pruned).toBe(2);
    expect([...store.data.keys()].sort()).toEqual(
      [`${RUN_PREFIX}${gkg(2)}.jsonl`, `${TIER1_PREFIX}${gkg(40)}.jsonl`].sort(),
    );
  });
});
