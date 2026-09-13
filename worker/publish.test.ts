import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { StoryGroup } from "../src/lib/types.ts";
import {
  ARCHIVE_DIR,
  ARCHIVE_PREFIX,
  type ArchiveStore,
  archiveKey,
  archivesToPrune,
  assertPublicHostReachable,
  assertStoreReachable,
  BAND_RELAX_AFTER_MS,
  COUNT_BAND_MAX,
  COUNT_BAND_MIN,
  checkInvariants,
  contentHash,
  HISTORY_KEY,
  type HistoryEntry,
  MANIFEST_KEY,
  MIN_COUNTRIES,
  nextHistory,
  pingHealthcheck,
  publish,
  REGIONS_PREFIX,
  staleness,
  statsOf,
} from "./publish.ts";
import { stampOfDate } from "./run.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function group(patch: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "g",
    title: "A headline",
    image: "",
    url: "https://a.com/1",
    domain: "a.com",
    lat: 1,
    lon: 2,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    adm1: "",
    placeName: "p",
    distinctDomains: 1,
    distinctSourceCountries: 1,
    salience: 1,
    tier1Fresh: false,
    newestTier1: "",
    newestArticle: "20260812110000",
    minzoom: 0,
    ...patch,
  };
}

function healthyGroups(count = 3_000): StoryGroup[] {
  return Array.from({ length: count }, (_, i) =>
    group({
      id: `g${i}`,
      countryCode: `C${i % (MIN_COUNTRIES + 5)}`,
      tier1Fresh: i % 20 === 0,
    })
  );
}

type MemoryStore = ArchiveStore & {
  data: Map<string, string | Uint8Array>;
  writes: string[];
  failOn?: string;
};

function memoryStore(seed: Record<string, string> = {}): MemoryStore {
  const data = new Map<string, string | Uint8Array>(Object.entries(seed));
  const store: MemoryStore = {
    data,
    writes: [],
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    async get(key) {
      const value = data.get(key);
      if (value === undefined) throw new Error(`missing ${key}`);
      return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
    },
    async put(key, body) {
      store.writes.push(key);
      data.set(key, body);
    },
    async remove(key) {
      data.delete(key);
    },
    async putBinary(key, body) {
      if (store.failOn && key.startsWith(store.failOn)) throw new Error("upload failed");
      store.writes.push(key);
      data.set(key, body);
      return `https://blob.example/${key}`;
    },
    async putText(key, body) {
      if (store.failOn && key.startsWith(store.failOn)) throw new Error("upload failed");
      store.writes.push(key);
      data.set(key, body);
      return `https://blob.example/${key}`;
    },
    urlOf(key) {
      return `https://blob.example/${key}`;
    },
  };
  return store;
}

function history(counts: number[]): HistoryEntry[] {
  return counts.map((groups, i) => ({
    stamp: stampOfDate(new Date(NOW.getTime() - (counts.length - i) * 60 * 60_000)),
    archive: `a${i}`,
    groups,
  }));
}

let archivePath = "";

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "oyster-publish-"));
  archivePath = path.join(dir, "stories.pmtiles");
  await writeFile(archivePath, "PMTiles bytes");
});

describe("statsOf", () => {
  it("counts distinct countries, tier-1 groups and titled groups", () => {
    const stats = statsOf([
      group({ countryCode: "US", tier1Fresh: true }),
      group({ countryCode: "US" }),
      group({ countryCode: "FR", title: "   " }),
      group({ countryCode: "" }),
    ]);
    expect(stats).toEqual({ groups: 4, countries: 2, tier1Groups: 1, titled: 3 });
  });
});

describe("checkInvariants", () => {
  const healthy = statsOf(healthyGroups());

  it("passes a healthy run", () => {
    expect(checkInvariants(healthy)).toEqual([]);
  });

  it("rejects an empty run", () => {
    const violations = checkInvariants(statsOf([]));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("no groups");
  });

  it("rejects a collapse and a flood against absolute bounds", () => {
    expect(checkInvariants(statsOf(healthyGroups(COUNT_BAND_MIN - 1)))[0]).toContain("outside");
    expect(checkInvariants(statsOf(healthyGroups(COUNT_BAND_MAX + 1)))[0]).toContain("outside");
    expect(checkInvariants(statsOf(healthyGroups(COUNT_BAND_MIN)))).toEqual([]);
    expect(checkInvariants(statsOf(healthyGroups(COUNT_BAND_MAX)))).toEqual([]);
  });

  it("is armed on the very first run, with nothing published before it", () => {
    expect(checkInvariants(statsOf(healthyGroups(200)))[0]).toContain("outside");
  });

  it("holds the bounds the constants are calibrated to", () => {
    expect(COUNT_BAND_MIN).toBe(2_000);
    expect(COUNT_BAND_MAX).toBe(60_000);
    expect(COUNT_BAND_MIN).toBeGreaterThan(1_467);
    expect(COUNT_BAND_MAX).toBeGreaterThan(40_700);
    expect(COUNT_BAND_MAX).toBeLessThan(75_000);
  });

  it("stands the band down once publication has been blocked past 2x cadence", () => {
    const flood = statsOf(healthyGroups(COUNT_BAND_MAX + 5_000));
    expect(checkInvariants(flood, BAND_RELAX_AFTER_MS - 1)[0]).toContain("outside");
    expect(checkInvariants(flood, BAND_RELAX_AFTER_MS)).toEqual([]);
  });

  it("keeps the other three invariants armed when the band stands down", () => {
    const collapsed = statsOf(
      healthyGroups(COUNT_BAND_MAX + 5_000).map((g) => ({ ...g, countryCode: "US" }))
    );
    const violations = checkInvariants(collapsed, BAND_RELAX_AFTER_MS * 10);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("distinct countries");
  });

  it("rejects a run whose stories collapsed onto a handful of countries", () => {
    const oneCountry = Array.from({ length: 3_000 }, (_, i) => group({ id: `g${i}` }));
    const violations = checkInvariants(statsOf(oneCountry));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("distinct countries");
  });

  it("rejects a run that lost its titles", () => {
    const groups = healthyGroups().map((g, i) => (i < 300 ? { ...g, title: "" } : g));
    const violations = checkInvariants(statsOf(groups));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("title");
  });

  it("reports every violation, not the first", () => {
    const groups = Array.from({ length: 3_000 }, (_, i) => group({ id: `g${i}`, title: "" }));
    expect(checkInvariants(statsOf(groups))).toHaveLength(2);
  });
});

describe("contentHash", () => {
  it("is stable for identical bytes and differs for changed bytes", () => {
    expect(contentHash(Buffer.from("abc"))).toBe(contentHash(Buffer.from("abc")));
    expect(contentHash(Buffer.from("abc"))).not.toBe(contentHash(Buffer.from("abd")));
    expect(archiveKey(contentHash(Buffer.from("abc")))).toMatch(
      /^archives\/stories-[0-9a-f]{8}\.pmtiles$/
    );
  });
});

describe("archivesToPrune", () => {
  it("keeps the last three published archives and nothing else", () => {
    const stored = ["a1", "a2", "a3", "a4", "a5"].map((h) => `${ARCHIVE_PREFIX}${h}.pmtiles`);
    const past = stored.map((archive, i) => ({ stamp: `${i}`, archive, groups: 100 }));
    expect(archivesToPrune(stored, past)).toEqual(stored.slice(0, 2));
  });

  it("prunes an orphan the manifest never pointed at", () => {
    const live = `${ARCHIVE_PREFIX}live.pmtiles`;
    const orphan = `${ARCHIVE_PREFIX}orphan.pmtiles`;
    expect(archivesToPrune([live, orphan], [{ stamp: "1", archive: live, groups: 100 }])).toEqual([
      orphan,
    ]);
  });

  it("ignores keys outside the archive prefix", () => {
    expect(archivesToPrune(["state/run-1.jsonl", MANIFEST_KEY], [])).toEqual([]);
  });

  it("keeps every key under a live city-shard directory", () => {
    const dir = `${ARCHIVE_DIR}cities-abcd1234/`;
    const stored = [`${dir}US.json`, `${dir}IN.json`, `${dir}FR.json`];
    const history: HistoryEntry[] = [
      { stamp: "1", archive: "archives/stories-x.pmtiles", cities: dir, groups: 100 },
    ];
    expect(archivesToPrune(stored, history)).toEqual([]);
  });

  it("prunes a whole city-shard directory once its generation ages out", () => {
    const dir = `${ARCHIVE_DIR}cities-old11111/`;
    const stored = [`${dir}US.json`, `${dir}IN.json`];
    expect(archivesToPrune(stored, [])).toEqual(stored);
  });
});

describe("nextHistory", () => {
  it("appends, replaces a re-published archive, and caps its length", () => {
    const past = history([1, 2, 3]);
    const added = nextHistory(past, { stamp: "s", archive: "a9", groups: 9 });
    expect(added.map((h) => h.archive)).toEqual(["a0", "a1", "a2", "a9"]);

    const repeat = nextHistory(past, { stamp: "s", archive: "a1", groups: 2 });
    expect(repeat.map((h) => h.archive)).toEqual(["a0", "a2", "a1"]);

    expect(
      nextHistory(history([1, 2, 3, 4, 5]), { stamp: "s", archive: "a9", groups: 9 }, 2)
    ).toHaveLength(2);
  });
});

describe("publish", () => {
  it("writes the archive, flips the manifest, records history and prunes", async () => {
    const store = memoryStore();
    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "20260812114500",
      now: NOW,
    });

    expect(result.published).toBe(true);
    if (!result.published) return;

    expect(result.manifest.archive).toBe(archiveKey(contentHash(Buffer.from("PMTiles bytes"))));
    expect(result.manifest.generatedAt).toBe("2026-08-12T12:00:00.000Z");
    expect(result.manifest.watermark).toBe("20260812114500");
    expect(result.manifest.stats).toEqual({ groups: 3_000, countries: 20, tier1Groups: 150 });

    const written = JSON.parse(String(store.data.get(MANIFEST_KEY)));
    expect(Object.keys(written).sort()).toEqual([
      "archive",
      "generatedAt",
      "regionsUrl",
      "regionsVersion",
      "stats",
      "url",
      "watermark",
    ]);

    expect(JSON.parse(String(store.data.get(HISTORY_KEY)))).toEqual([
      {
        stamp: "20260812114500",
        archive: result.manifest.archive,
        regions: expect.stringMatching(/^archives\/regions-[0-9a-f]{8}\.json$/),
        groups: 3_000,
      },
    ]);
  });

  it("uploads the archive before it flips the manifest", async () => {
    const store = memoryStore();
    await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "1",
      now: NOW,
    });
    expect(store.writes.indexOf(MANIFEST_KEY)).toBeGreaterThan(
      store.writes.findIndex((key) => key.startsWith(ARCHIVE_PREFIX))
    );
  });

  it("uploads the region index before it flips the manifest", async () => {
    const store = memoryStore();
    await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: { US: [{ title: "t", source: "s", url: "u", date: "20260812110000", place: "p" }] },
      watermark: "1",
      now: NOW,
    });
    expect(store.writes.indexOf(MANIFEST_KEY)).toBeGreaterThan(
      store.writes.findIndex((key) => key.startsWith(REGIONS_PREFIX))
    );
  });

  it("publishes nothing when a run has no cities, and the manifest omits citiesBase", async () => {
    const store = memoryStore();
    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "1",
      now: NOW,
    });
    expect(result.published).toBe(true);
    if (!result.published) return;
    expect(result.manifest.citiesBase).toBeUndefined();
    expect([...store.data.keys()].some((key) => key.includes("cities-"))).toBe(false);
  });

  it("uploads every city shard before it flips the manifest, and points citiesBase at the directory", async () => {
    const store = memoryStore();
    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      cities: {
        US: [
          {
            name: "Chicago",
            adm1Name: "Illinois",
            lat: 41.9,
            lon: -87.6,
            total: 5,
            sources: 2,
            stories: [],
          },
        ],
        IN: [
          {
            name: "Mumbai",
            adm1Name: "Maharashtra",
            lat: 19.1,
            lon: 72.9,
            total: 3,
            sources: 1,
            stories: [],
          },
        ],
      },
      watermark: "1",
      now: NOW,
    });

    expect(result.published).toBe(true);
    if (!result.published) return;

    const manifestIndex = store.writes.indexOf(MANIFEST_KEY);
    const shardIndices = store.writes
      .map((key, i) => [key, i] as const)
      .filter(([key]) => key.includes("cities-"))
      .map(([, i]) => i);

    expect(shardIndices).toHaveLength(2);
    expect(Math.max(...shardIndices)).toBeLessThan(manifestIndex);
    expect(result.manifest.citiesBase).toMatch(
      /^https:\/\/blob\.example\/archives\/cities-[0-9a-f]{8}\/$/
    );

    const dir = result.manifest.citiesBase!.replace("https://blob.example/", "");
    expect(JSON.parse(String(store.data.get(`${dir}US.json`)))[0].name).toBe("Chicago");
    expect(JSON.parse(String(store.data.get(`${dir}IN.json`)))[0].name).toBe("Mumbai");
  });

  it("retains a city-shard directory inside KEEP_ARCHIVES, and prunes one four generations back", async () => {
    const seed: Record<string, string> = {
      [HISTORY_KEY]: JSON.stringify(
        [1, 2, 3].map((n) => ({
          stamp: String(n),
          archive: `archives/stories-gen${n}.pmtiles`,
          cities: `archives/cities-gen${n}/`,
          groups: 3_000,
        }))
      ),
    };
    for (const n of [1, 2, 3]) {
      seed[`archives/stories-gen${n}.pmtiles`] = `gen${n}`;
      seed[`archives/cities-gen${n}/US.json`] = `gen${n}`;
    }
    const store = memoryStore(seed);

    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      cities: {
        US: [
          {
            name: "Chicago",
            adm1Name: "IL",
            lat: 41.9,
            lon: -87.6,
            total: 1,
            sources: 1,
            stories: [],
          },
        ],
      },
      watermark: "4",
      now: NOW,
    });
    expect(result.published).toBe(true);

    const remaining = await store.list(ARCHIVE_DIR);
    expect(remaining).not.toContain("archives/cities-gen1/US.json");
    expect(remaining).toContain("archives/cities-gen2/US.json");
    expect(remaining).toContain("archives/cities-gen3/US.json");
  });

  it("retains an archive and its index together, and prunes both when they age out", async () => {
    const store = memoryStore({
      "archives/stories-old.pmtiles": "old",
      "archives/regions-old.json": "old",
      [HISTORY_KEY]: JSON.stringify([
        {
          stamp: "1",
          archive: "archives/stories-old.pmtiles",
          regions: "archives/regions-old.json",
          groups: 100,
        },
      ]),
    });

    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "2",
      now: NOW,
    });
    expect(result.published).toBe(true);

    const remaining = await store.list(ARCHIVE_DIR);
    expect(remaining).toContain("archives/stories-old.pmtiles");
    expect(remaining).toContain("archives/regions-old.json");
  });

  it("prunes a region index left by a generation that has aged out", async () => {
    const seed: Record<string, string> = {
      [HISTORY_KEY]: JSON.stringify(
        [1, 2, 3].map((n) => ({
          stamp: String(n),
          archive: `archives/stories-gen${n}.pmtiles`,
          regions: `archives/regions-gen${n}.json`,
          groups: 3_000,
        }))
      ),
    };
    for (const n of [1, 2, 3]) {
      seed[`archives/stories-gen${n}.pmtiles`] = `gen${n}`;
      seed[`archives/regions-gen${n}.json`] = `gen${n}`;
    }
    const store = memoryStore(seed);

    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "4",
      now: NOW,
    });
    expect(result.published).toBe(true);

    const remaining = await store.list(ARCHIVE_DIR);
    expect(remaining).not.toContain("archives/stories-gen1.pmtiles");
    expect(remaining).not.toContain("archives/regions-gen1.json");
    expect(remaining).toContain("archives/regions-gen2.json");
    expect(remaining).toContain("archives/regions-gen3.json");
  });

  it("leaves the previous manifest intact when the archive upload fails", async () => {
    const store = memoryStore({ [MANIFEST_KEY]: '{"archive":"archives/stories-old.pmtiles"}' });
    store.failOn = ARCHIVE_PREFIX;

    await expect(
      publish({
        store,
        archivePath,
        groups: healthyGroups(),
        regions: {},
        watermark: "1",
        now: NOW,
      })
    ).rejects.toThrow("upload failed");

    expect(String(store.data.get(MANIFEST_KEY))).toContain("stories-old.pmtiles");
  });

  it("publishes nothing when an invariant fails, and touches no key", async () => {
    const store = memoryStore({
      [MANIFEST_KEY]: '{"archive":"archives/stories-old.pmtiles"}',
      [HISTORY_KEY]: JSON.stringify(history([1000, 1000, 1000])),
    });

    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(10),
      regions: {},
      watermark: "20260812114500",
      now: NOW,
    });

    expect(result.published).toBe(false);
    if (result.published) return;
    expect(result.violations[0]).toContain("outside");
    expect(store.writes).toEqual([]);
    expect(String(store.data.get(MANIFEST_KEY))).toContain("stories-old.pmtiles");
  });

  it("does not relax the band on the first run of an empty store", async () => {
    const store = memoryStore({});

    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(200),
      regions: {},
      watermark: "20260812114500",
      now: NOW,
    });

    expect(result.published).toBe(false);
    if (result.published) return;
    expect(result.violations[0]).toContain("outside");
    expect(store.writes).toEqual([]);
  });

  it("prunes only after the manifest has flipped", async () => {
    const older = ["p1", "p2", "p3", "p4"].map((h) => `${ARCHIVE_PREFIX}${h}.pmtiles`);
    const store = memoryStore({
      ...Object.fromEntries(older.map((key) => [key, "old"])),
      [HISTORY_KEY]: JSON.stringify(
        older.map((archive, i) => ({ stamp: `${i}`, archive, groups: 100 }))
      ),
    });

    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "20260812114500",
      now: NOW,
    });

    expect(result.published).toBe(true);
    if (!result.published) return;

    const remaining = await store.list(ARCHIVE_PREFIX);
    expect(remaining).toHaveLength(3);
    expect(remaining).toContain(result.manifest.archive);
    expect(result.pruned).toBe(2);
  });

  it("survives a corrupt history rather than blocking publication", async () => {
    const store = memoryStore({ [HISTORY_KEY]: "{not json" });
    const result = await publish({
      store,
      archivePath,
      groups: healthyGroups(),
      regions: {},
      watermark: "1",
      now: NOW,
    });
    expect(result.published).toBe(true);
  });
});

describe("staleness", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("measures from the newest stamp, not the last entry", () => {
    const entries: HistoryEntry[] = [
      { stamp: "20260813110000", archive: "a", groups: 1 },
      { stamp: "20260813090000", archive: "b", groups: 1 },
    ];
    expect(staleness(entries, now)).toBe(60 * 60_000);
  });

  it("reports an unpublished store as infinitely stale rather than 1970", () => {
    expect(staleness([], now)).toBe(Number.POSITIVE_INFINITY);
    expect(staleness([{ stamp: "not-a-stamp", archive: "a", groups: 1 }], now)).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});

describe("assertStoreReachable", () => {
  it("passes on a store the token can read", async () => {
    await expect(assertStoreReachable(memoryStore())).resolves.toBeUndefined();
  });

  it("names the credentials, and keeps the underlying error as the cause", async () => {
    const store = memoryStore();
    const cause = new Error("HTTP 403 SignatureDoesNotMatch");
    store.list = async () => {
      throw cause;
    };
    await expect(assertStoreReachable(store)).rejects.toThrow("R2_ACCOUNT_ID");
    await expect(assertStoreReachable(store)).rejects.toMatchObject({ cause });
  });
});

describe("assertPublicHostReachable", () => {
  it("HEADs the manifest on the public base", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push([String(url), init?.method]);
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await expect(
      assertPublicHostReachable("https://cdn.example", doFetch)
    ).resolves.toBeUndefined();
    expect(seen).toEqual([["https://cdn.example/manifest.json", "HEAD"]]);
  });

  it("passes on 404 — an empty bucket still proves DNS, TLS and routing", async () => {
    const doFetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof globalThis.fetch;
    await expect(
      assertPublicHostReachable("https://cdn.example", doFetch)
    ).resolves.toBeUndefined();
  });

  it("fails on a transport error, naming CDN_BASE and keeping the cause", async () => {
    const cause = new Error("getaddrinfo ENOTFOUND cdn.example");
    const doFetch = (async () => {
      throw cause;
    }) as unknown as typeof globalThis.fetch;

    await expect(assertPublicHostReachable("https://cdn.example", doFetch)).rejects.toThrow(
      "CDN_BASE"
    );
    await expect(assertPublicHostReachable("https://cdn.example", doFetch)).rejects.toMatchObject({
      cause,
    });
  });
});

describe("pingHealthcheck", () => {
  it("reports false without a configured URL rather than throwing", async () => {
    expect(await pingHealthcheck(undefined)).toBe(false);
    expect(await pingHealthcheck("")).toBe(false);
  });

  it("swallows a failed ping — monitoring must not fail a successful run", async () => {
    expect(await pingHealthcheck("http://127.0.0.1:1/never")).toBe(false);
  });
});
