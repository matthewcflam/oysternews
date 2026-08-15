import { describe, expect, it } from "vitest";
import {
  EMPTY_SPIDER,
  SPIDERFY_ZOOM,
  coordKey,
  displacedUrls,
  leafOffsets,
  sameStacks,
  spiderData,
  stacksFrom,
  type Projection,
} from "./spiderfy";

/** A rendered pin, with only what the grouping is allowed to look at. */
const pin = (url: string, lng: number, lat: number, salience = 1, date = "20260814000000") => ({
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { url, salience, date, kind: "PIN" },
});

/**
 * A square, linear stand-in for Web Mercator. The real projection is neither,
 * but every property this module has to hold — offsets in pixels, legs joining
 * anchor to leaf, shape preserved under zoom — is independent of it.
 */
const flat = (scale = 1): Projection => ({
  project: ([lng, lat]) => ({ x: lng * scale, y: -lat * scale }),
  unproject: ([x, y]) => ({ lng: x / scale, lat: -y / scale }),
});

describe("stacksFrom", () => {
  it("groups only stories at exactly the same coordinate", () => {
    // GDELT gives city centroids, so co-location is exact and not a rounding
    // artifact. Two points a metre apart are two different places.
    const stacks = stacksFrom([
      pin("a", -87.65, 41.85),
      pin("b", -87.65, 41.85),
      pin("c", -87.65001, 41.85),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].members.map((m) => m.url)).toEqual(["a", "b"]);
  });

  it("ignores a lone pin — there is nothing to spread", () => {
    expect(stacksFrom([pin("a", 0, 0), pin("b", 1, 1)])).toEqual([]);
  });

  it("deduplicates by URL before grouping", () => {
    // With renderWorldCopies on, one story is rendered once per visible copy of
    // the planet, and again in the country floor where the layers overlap
    // (§2.4). Without the dedupe a single story would spider against itself.
    expect(stacksFrom([pin("a", 5, 5), pin("a", 5, 5), pin("a", 5, 5)])).toEqual([]);
  });

  it("puts the most salient member first — it is the one that keeps the anchor", () => {
    const stacks = stacksFrom([
      pin("weak", 0, 0, 0.7),
      pin("strong", 0, 0, 4.3),
      pin("middle", 0, 0, 2.3),
    ]);
    expect(stacks[0].members.map((m) => m.url)).toEqual(["strong", "middle", "weak"]);
  });

  it("orders tied members by date then URL, so the anchor never flickers", () => {
    // Half of all stories sit at exactly log1p(1) salience (§2.5), so ties are
    // the common case. If the anchor changed as the reader panned, the whole
    // spider would rotate under them.
    const stacks = stacksFrom([
      pin("b", 0, 0, 1, "20260813000000"),
      pin("a", 0, 0, 1, "20260814000000"),
      pin("c", 0, 0, 1, "20260814000000"),
    ]);
    expect(stacks[0].members.map((m) => m.url)).toEqual(["a", "c", "b"]);
  });

  it("skips features it cannot place or identify", () => {
    const stacks = stacksFrom([
      pin("a", 0, 0),
      pin("b", 0, 0),
      { geometry: { type: "Point", coordinates: [0, 0] }, properties: { salience: 9 } },
      { geometry: { type: "LineString", coordinates: [] }, properties: { url: "line" } },
      { properties: { url: "no-geometry" } },
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].members.map((m) => m.url)).toEqual(["a", "b"]);
  });
});

describe("leafOffsets", () => {
  it("puts a small stack on one ring, first leaf at 12 o'clock", () => {
    const offsets = leafOffsets(4);
    expect(offsets).toHaveLength(4);
    const [x, y] = offsets[0];
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeLessThan(0); // screen y grows downward
  });

  it("keeps every leaf clear of the anchor's own disc", () => {
    // The largest pin is 13px + its ring at z8+. A leaf inside that radius would
    // be hidden by the very disc it was displaced from.
    for (const count of [2, 5, 8, 14]) {
      for (const [x, y] of leafOffsets(count)) {
        expect(Math.hypot(x, y)).toBeGreaterThan(16);
      }
    }
  });

  it("spirals past eight rather than crowding one ring", () => {
    // 14 is the biggest stack measured on the live archive. On a single ring at
    // this radius the leaves would sit closer to each other than to the anchor.
    const offsets = leafOffsets(14);
    expect(offsets).toHaveLength(14);
    const radii = offsets.map(([x, y]) => Math.hypot(x, y));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it("keeps even the biggest stack near the city it belongs to", () => {
    // Measured 2026-08-14: the first spiral put the outermost leaf ~240px from
    // its anchor, which at z9 is two suburbs away — a leaf that far out is not
    // read as belonging to the pin it came from.
    for (const [x, y] of leafOffsets(14)) expect(Math.hypot(x, y)).toBeLessThan(140);
  });

  it("never repeats a bearing, so legs do not stack into spokes", () => {
    // An even 2π/n step puts every nth leaf on the same line out of the anchor.
    const bearings = leafOffsets(14).map(([x, y]) => Math.round((Math.atan2(y, x) * 180) / Math.PI));
    expect(new Set(bearings).size).toBe(bearings.length);
  });

  it("returns nothing for an empty stack", () => {
    expect(leafOffsets(0)).toEqual([]);
  });
});

describe("spiderData", () => {
  const stacks = stacksFrom([
    pin("strong", 10, 20, 4),
    pin("mid", 10, 20, 2),
    pin("weak", 10, 20, 1),
  ]);

  it("leaves the best member at the anchor and displaces the rest", () => {
    const data = spiderData(stacks, flat());
    const leaves = data.features.filter((f) => f.geometry.type === "Point");
    const legs = data.features.filter((f) => f.geometry.type === "LineString");
    // Three members, two leaves: the anchor keeps the best story, which is what
    // makes the stacked features underneath it invisible rather than wrong.
    expect(leaves).toHaveLength(2);
    expect(legs).toHaveLength(2);
    expect(leaves.map((f) => f.properties?.url)).toEqual(["mid", "weak"]);
  });

  it("joins every leg to the anchor at one end and its leaf at the other", () => {
    const data = spiderData(stacks, flat());
    const legs = data.features.filter((f) => f.geometry.type === "LineString");
    const leaves = data.features.filter((f) => f.geometry.type === "Point");
    legs.forEach((leg, index) => {
      const line = leg.geometry as unknown as { coordinates: [number, number][] };
      const leaf = leaves[index].geometry as unknown as { coordinates: [number, number] };
      expect(line.coordinates[0]).toEqual([10, 20]);
      expect(line.coordinates[1]).toEqual(leaf.coordinates);
    });
  });

  it("carries the story's own properties onto its leaf", () => {
    // A leaf is clickable (§2.6's popup) and paints from `kind`, so it has to be
    // the same story, not a marker that merely stands for one.
    const [leaf] = spiderData(stacks, flat()).features.filter((f) => f.geometry.type === "Point");
    expect(leaf.properties).toMatchObject({ url: "mid", kind: "PIN", salience: 2 });
  });

  it("hands the top-5 flag to the leaf as a property", () => {
    // Feature state belongs to the vector source; a leaf lives in a GeoJSON
    // source of its own and cannot inherit it, so the flag travels as data.
    const data = spiderData(stacks, flat(), ["weak"]);
    const flags = data.features
      .filter((f) => f.geometry.type === "Point")
      .map((f) => [f.properties?.url, f.properties?.top]);
    expect(flags).toEqual([
      ["mid", 0],
      ["weak", 1],
    ]);
  });

  it("keeps the spider the same size in PIXELS at any zoom", () => {
    // The offsets are pixel distances put back through the live camera. If they
    // were geographic, a spider would balloon on zoom-out and vanish on zoom-in.
    const near = spiderData(stacks, flat(1));
    const far = spiderData(stacks, flat(4));
    const first = (data: typeof near) =>
      (data.features.find((f) => f.geometry.type === "Point")!.geometry as unknown as {
        coordinates: [number, number];
      }).coordinates;
    const [nearLng] = first(near);
    const [farLng] = first(far);
    // Same pixel offset, so four times the scale means a quarter of the degrees.
    expect(Math.abs(nearLng - 10)).toBeCloseTo(4 * Math.abs(farLng - 10), 6);
  });

  it("draws nothing for no stacks", () => {
    expect(spiderData([], flat())).toEqual(EMPTY_SPIDER);
  });
});

describe("displacedUrls", () => {
  const stacks = stacksFrom([
    pin("a", 1, 1, 3),
    pin("b", 1, 1, 2),
    pin("c", 1, 1, 1),
    pin("d", 2, 2, 5),
    pin("e", 2, 2, 4),
  ]);

  it("names every member a spider moved, and never the anchor", () => {
    // The anchor is the only member still drawn where the tile puts it, so it is
    // the only one that may carry the top-5 flag on the vector source. Flagging
    // a displaced member scales its covered copy by TOP_SCALE and pushes it out
    // from behind the anchor — the overlap this whole split exists to remove.
    expect(displacedUrls(stacks)).toEqual(new Set(["b", "c", "e"]));
  });

  it("is empty when there are no spiders, so nothing is withheld", () => {
    // Below SPIDERFY_ZOOM MapView passes an empty stack list, and every marked
    // story must go back to being flagged normally.
    expect(displacedUrls([])).toEqual(new Set());
  });

  it("drops a member with no url rather than withholding the empty key", () => {
    const anonymous = [{ lng: 0, lat: 0, members: [{ url: "a" }, { salience: 1 }] }];
    expect(displacedUrls(anonymous)).toEqual(new Set());
  });
});

describe("sameStacks", () => {
  it("is the guard that stops the overlay rebuilding on every frame", () => {
    const one = stacksFrom([pin("a", 0, 0), pin("b", 0, 0)]);
    const same = stacksFrom([pin("a", 0, 0), pin("b", 0, 0)]);
    const more = stacksFrom([pin("a", 0, 0), pin("b", 0, 0), pin("c", 0, 0)]);
    expect(sameStacks(one, same)).toBe(true);
    expect(sameStacks(one, more)).toBe(false);
    expect(sameStacks(one, [])).toBe(false);
  });
});

describe("the two halves agree on one number", () => {
  it("exports the zoom the worker's coordinate cap lifts at", () => {
    // worker/budget.ts imports THIS constant. If the client and the tiles ever
    // disagree, either stacks appear with nothing to spread them or the budget
    // hides stories the map is ready to show.
    expect(SPIDERFY_ZOOM).toBe(9);
  });

  it("keys a coordinate exactly, the same way on both sides", () => {
    expect(coordKey(-87.65, 41.85)).toBe("-87.65,41.85");
    expect(coordKey(-87.65, 41.85)).not.toBe(coordKey(-87.6500001, 41.85));
  });
});
