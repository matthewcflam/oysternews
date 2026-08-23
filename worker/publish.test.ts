import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { StoryGroup } from "../lib/types.ts";
import {
  ARCHIVE_DIR,
  ARCHIVE_PREFIX,
  BAND_RELAX_AFTER_MS,
  COUNT_BAND_MAX,
  COUNT_BAND_MIN,
  REGIONS_PREFIX,
  HISTORY_KEY,
  type ArchiveStore,
  type HistoryEntry,
  MANIFEST_KEY,
  MIN_COUNTRIES,
  archiveKey,
  archivesToPrune,
  assertStoreReachable,
  checkInvariants,
  contentHash,
  nextHistory,
  pingHealthcheck,
  publish,
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

/**
 * A pool that clears every invariant, so each test only has to break one thing.
 *
 * **The default count is load-bearing as of 2026-08-14.** The count band is
 * absolute now, so a pool has to sit inside [COUNT_BAND_MIN, COUNT_BAND_MAX] to
 * be "healthy" at all — the previous default of 100 would fail the floor and
 * every test here would be asserting against the wrong violation.
 */
function healthyGroups(count = 3_000): StoryGroup[] {
  return Array.from({ length: count }, (_, i) =>
    group({
      id: `g${i}`,
      // Well above MIN_COUNTRIES, and spread so no single country dominates.
      countryCode: `C${i % (MIN_COUNTRIES + 5)}`,
      tier1Fresh: i % 20 === 0,
    }),
  );
}

type MemoryStore = ArchiveStore & {
  data: Map<string, string | Uint8Array>;
  /** Every key written, in order — the flip-ordering assertions read this. */
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

/**
 * A published history ending one hour before NOW.
 *
 * The stamps have to sit close to NOW rather than at a fixed point in the past:
 * the count band only applies while publication is current (BAND_RELAX_AFTER_MS),
 * so a history stamped twelve hours back would silently disarm the very
 * invariant most of these tests are about.
 */
function history(counts: number[]): HistoryEntry[] {
  return counts.map((groups, i) => ({
    stamp: stampOfDate(new Date(NOW.getTime() - (counts.length - i) * 60 * 60_000)),
    archive: `a${i}`,
    groups,
  }));
}

let archivePath = "";

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sonder-publish-"));
  archivePath = path.join(dir, "stories.pmtiles");
  await writeFile(archivePath, "PMTiles bytes");
});

describe("statsOf", () => {
  it("counts distinct countries, tier-1 groups and titled groups", () => {
    const stats = statsOf([
      group({ countryCode: "US", tier1Fresh: true }),
      group({ countryCode: "US" }),
      group({ countryCode: "FR", title: "   " }),
      // An empty country code is not a country — placement failed to attribute it.
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
    // The band is inclusive at both edges.
    expect(checkInvariants(statsOf(healthyGroups(COUNT_BAND_MIN)))).toEqual([]);
    expect(checkInvariants(statsOf(healthyGroups(COUNT_BAND_MAX)))).toEqual([]);
  });

  it("is armed on the very first run, with nothing published before it", () => {
    // The old ratio band was inert until BAND_MIN_HISTORY entries existed, so a
    // bootstrap run published whatever it produced. Absolute bounds have no
    // bootstrap hole — that is half the reason for making them absolute.
    expect(checkInvariants(statsOf(healthyGroups(200)))[0]).toContain("outside");
  });

  it("holds the bounds the constants are calibrated to", () => {
    // These are not arbitrary, and a nudge to make a failing run pass is exactly
    // the change this catches. The floor sits above a 1-bundle smoke run (1,467,
    // measured 2026-08-12); the ceiling sits between steady state (~40,700, §4)
    // and total grouping failure (~75,000). Re-derive from §4, do not nudge.
    expect(COUNT_BAND_MIN).toBe(2_000);
    expect(COUNT_BAND_MAX).toBe(60_000);
    expect(COUNT_BAND_MIN).toBeGreaterThan(1_467);
    expect(COUNT_BAND_MAX).toBeGreaterThan(40_700);
    expect(COUNT_BAND_MAX).toBeLessThan(75_000);
  });

  it("stands the band down once publication has been blocked past 2x cadence", () => {
    // The wedge this protects against changed shape on 2026-08-14. It used to be
    // a self-poisoning median; now it is a stale constant — if real volume
    // outgrows COUNT_BAND_MAX nothing self-corrects, and this valve is all there
    // is between that and a dead map.
    const flood = statsOf(healthyGroups(COUNT_BAND_MAX + 5_000));
    expect(checkInvariants(flood, BAND_RELAX_AFTER_MS - 1)[0]).toContain("outside");
    expect(checkInvariants(flood, BAND_RELAX_AFTER_MS)).toEqual([]);
  });

  it("keeps the other three invariants armed when the band stands down", () => {
    // The band is the only one carrying a number that can go out of date without
    // anything in the pipeline noticing. The floors catch actual garbage and must
    // not be relaxed with it.
    const collapsed = statsOf(
      healthyGroups(COUNT_BAND_MAX + 5_000).map((g) => ({ ...g, countryCode: "US" })),
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
    expect(archiveKey(contentHash(Buffer.from("abc")))).toMatch(/^archives\/stories-[0-9a-f]{8}\.pmtiles$/);
  });
});

describe("archivesToPrune", () => {
  it("keeps the last three published archives and nothing else", () => {
    const stored = ["a1", "a2", "a3", "a4", "a5"].map((h) => `${ARCHIVE_PREFIX}${h}.pmtiles`);
    const past = stored.map((archive, i) => ({ stamp: `${i}`, archive, groups: 100 }));
    expect(archivesToPrune(stored, past)).toEqual(stored.slice(0, 2));
  });

  it("prunes an orphan the manifest never pointed at", () => {
    // The realistic case: a run uploaded an archive and then failed. Nothing
    // references it, so it should go on the next successful run, not age out.
    const live = `${ARCHIVE_PREFIX}live.pmtiles`;
    const orphan = `${ARCHIVE_PREFIX}orphan.pmtiles`;
    expect(archivesToPrune([live, orphan], [{ stamp: "1", archive: live, groups: 100 }])).toEqual([
      orphan,
    ]);
  });

  it("ignores keys outside the archive prefix", () => {
    expect(archivesToPrune(["state/run-1.jsonl", MANIFEST_KEY], [])).toEqual([]);
  });

  it("keeps every key under a live city-shard directory (§4)", () => {
    // §4: a run's own shards must not look unreferenced the moment they
    // finish uploading — see the comment on `entry.cities` in publish.ts.
    const dir = `${ARCHIVE_DIR}cities-abcd1234/`;
    const stored = [`${dir}US.json`, `${dir}IN.json`, `${dir}FR.json`];
    const history: HistoryEntry[] = [{ stamp: "1", archive: "archives/stories-x.pmtiles", cities: dir, groups: 100 }];
    expect(archivesToPrune(stored, history)).toEqual([]);
  });

  it("prunes a whole city-shard directory once its generation ages out", () => {
    const dir = `${ARCHIVE_DIR}cities-old11111/`;
    const stored = [`${dir}US.json`, `${dir}IN.json`];
    // Nothing in a 3-deep history references this directory any more.
    expect(archivesToPrune(stored, [])).toEqual(stored);
  });
});

describe("nextHistory", () => {
  it("appends, replaces a re-published archive, and caps its length", () => {
    const past = history([1, 2, 3]);
    const added = nextHistory(past, { stamp: "s", archive: "a9", groups: 9 });
    expect(added.map((h) => h.archive)).toEqual(["a0", "a1", "a2", "a9"]);

    // Identical data hashes to an identical key; it must not appear twice.
    const repeat = nextHistory(past, { stamp: "s", archive: "a1", groups: 2 });
    expect(repeat.map((h) => h.archive)).toEqual(["a0", "a2", "a1"]);

    expect(nextHistory(history([1, 2, 3, 4, 5]), { stamp: "s", archive: "a9", groups: 9 }, 2)).toHaveLength(2);
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

    // §2.6: the manifest is link-out metadata only. No article text reaches it.
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
    // §7 critical gap 1. If this order ever inverts, a failed archive upload
    // leaves the manifest pointing at a key that does not exist.
    const store = memoryStore();
    await publish({ store, archivePath, groups: healthyGroups(), regions: {}, watermark: "1", now: NOW });
    expect(store.writes.indexOf(MANIFEST_KEY)).toBeGreaterThan(
      store.writes.findIndex((key) => key.startsWith(ARCHIVE_PREFIX)),
    );
  });

  it("uploads the region index before it flips the manifest", async () => {
    // Same reason as the archive: the flip is the only thing the browser sees,
    // so everything the manifest will point at has to exist first. A panel that
    // 404s is a broken feature on an otherwise working map.
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
      store.writes.findIndex((key) => key.startsWith(REGIONS_PREFIX)),
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
        US: [{ name: "Chicago", adm1Name: "Illinois", lat: 41.9, lon: -87.6, total: 5, sources: 2, stories: [] }],
        IN: [{ name: "Mumbai", adm1Name: "Maharashtra", lat: 19.1, lon: 72.9, total: 3, sources: 1, stories: [] }],
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
    expect(result.manifest.citiesBase).toMatch(/^https:\/\/blob\.example\/archives\/cities-[0-9a-f]{8}\/$/);

    const dir = result.manifest.citiesBase!.replace("https://blob.example/", "");
    expect(JSON.parse(String(store.data.get(`${dir}US.json`)))[0].name).toBe("Chicago");
    expect(JSON.parse(String(store.data.get(`${dir}IN.json`)))[0].name).toBe("Mumbai");
  });

  it("retains a city-shard directory inside KEEP_ARCHIVES, and prunes one four generations back", async () => {
    // Same shape as "prunes a region index left by a generation that has aged
    // out" just below: seed three prior generations, publish a fourth, and
    // check generation 1 (now outside the 3-deep window) is gone while
    // generations 2 and 3 (still inside it) survive.
    const seed: Record<string, string> = {
      [HISTORY_KEY]: JSON.stringify(
        [1, 2, 3].map((n) => ({
          stamp: String(n),
          archive: `archives/stories-gen${n}.pmtiles`,
          cities: `archives/cities-gen${n}/`,
          groups: 3_000,
        })),
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
      cities: { US: [{ name: "Chicago", adm1Name: "IL", lat: 41.9, lon: -87.6, total: 1, sources: 1, stories: [] }] },
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
    // They are one publication. Pruning on the stories prefix alone would have
    // leaked every index ever written, silently and for ever.
    const store = memoryStore({
      "archives/stories-old.pmtiles": "old",
      "archives/regions-old.json": "old",
      [HISTORY_KEY]: JSON.stringify([
        { stamp: "1", archive: "archives/stories-old.pmtiles", regions: "archives/regions-old.json", groups: 100 },
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

    // One publication back is still inside KEEP_ARCHIVES, so both old keys live.
    const remaining = await store.list(ARCHIVE_DIR);
    expect(remaining).toContain("archives/stories-old.pmtiles");
    expect(remaining).toContain("archives/regions-old.json");
  });

  /**
   * The other half of the test above, and the half that was missing.
   *
   * That one asserts the *retained* case only — both keys survive because the
   * publication is still inside `KEEP_ARCHIVES`. Its name promised "and prunes
   * both when they age out" and nothing checked it, which is how the store came
   * to hold every region index ever published: `publish` listed with
   * `ARCHIVE_PREFIX` (`archives/stories-`), and `archivesToPrune` can only
   * delete keys the listing returned. The stories archive was swept, its index
   * was invisible, and the `pruned` count looked correct throughout.
   *
   * Four publications, so the first falls out of the 3-deep window.
   */
  it("prunes a region index left by a generation that has aged out", async () => {
    const seed: Record<string, string> = {
      [HISTORY_KEY]: JSON.stringify(
        [1, 2, 3].map((n) => ({
          stamp: String(n),
          archive: `archives/stories-gen${n}.pmtiles`,
          regions: `archives/regions-gen${n}.json`,
          groups: 3_000,
        })),
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
    // Generation 1 is now four publications back, outside KEEP_ARCHIVES.
    expect(remaining).not.toContain("archives/stories-gen1.pmtiles");
    expect(remaining).not.toContain("archives/regions-gen1.json");
    // And the two still inside the window are untouched — a sweep that widened
    // far enough to delete a live index would be a worse bug than the leak.
    expect(remaining).toContain("archives/regions-gen2.json");
    expect(remaining).toContain("archives/regions-gen3.json");
  });

  it("leaves the previous manifest intact when the archive upload fails", async () => {
    const store = memoryStore({ [MANIFEST_KEY]: '{"archive":"archives/stories-old.pmtiles"}' });
    store.failOn = ARCHIVE_PREFIX;

    await expect(
      publish({ store, archivePath, groups: healthyGroups(), regions: {}, watermark: "1", now: NOW }),
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
    // `staleness` returns Infinity on an empty history — "nothing has published,
    // so nothing is protecting anything". Handed straight to the relax valve that
    // reads as "blocked for longer than 8 hours" and stands the band down, so a
    // fresh store would publish any count at all on its very first run. The old
    // BAND_MIN_HISTORY gate covered this by accident; `history.length > 0` is now
    // the condition, and this is the test that keeps it there.
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
    // §5: the archive being replaced has to survive until it is unreferenced.
    const older = ["p1", "p2", "p3", "p4"].map((h) => `${ARCHIVE_PREFIX}${h}.pmtiles`);
    const store = memoryStore({
      ...Object.fromEntries(older.map((key) => [key, "old"])),
      [HISTORY_KEY]: JSON.stringify(older.map((archive, i) => ({ stamp: `${i}`, archive, groups: 100 }))),
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

    // Four old + this run's = five; three survive, and the new one is among them.
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
    // nextHistory appends, so the newest entry is normally last — but the band's
    // escape hatch must not hinge on that ordering holding.
    const entries: HistoryEntry[] = [
      { stamp: "20260813110000", archive: "a", groups: 1 },
      { stamp: "20260813090000", archive: "b", groups: 1 },
    ];
    expect(staleness(entries, now)).toBe(60 * 60_000);
  });

  it("reports an unpublished store as infinitely stale rather than 1970", () => {
    expect(staleness([], now)).toBe(Number.POSITIVE_INFINITY);
    expect(staleness([{ stamp: "not-a-stamp", archive: "a", groups: 1 }], now)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("assertStoreReachable", () => {
  it("passes on a store the token can read", async () => {
    await expect(assertStoreReachable(memoryStore())).resolves.toBeUndefined();
  });

  it("names the credentials, and keeps the underlying error as the cause", async () => {
    // The regression: a bad credential used to surface as a bare 403 from
    // inside appendShards, four steps downstream, because every read swallows
    // its own failure as "not written yet". The message has to name the R2
    // env vars — that is the entire point of the check.
    const store = memoryStore();
    const cause = new Error("HTTP 403 SignatureDoesNotMatch");
    store.list = async () => {
      throw cause;
    };
    await expect(assertStoreReachable(store)).rejects.toThrow("R2_ACCOUNT_ID");
    await expect(assertStoreReachable(store)).rejects.toMatchObject({ cause });
  });
});

// r2Store's own contracts (urlOf, putBinary/putText's public-URL return,
// no-transform on the archive only, list pagination) live in
// store.test.ts, against a mocked fetch — these are the r2Store
// equivalents of the two tests removed here on the R2 migration.

describe("pingHealthcheck", () => {
  it("reports false without a configured URL rather than throwing", async () => {
    expect(await pingHealthcheck(undefined)).toBe(false);
    expect(await pingHealthcheck("")).toBe(false);
  });

  it("swallows a failed ping — monitoring must not fail a successful run", async () => {
    expect(await pingHealthcheck("http://127.0.0.1:1/never")).toBe(false);
  });
});
