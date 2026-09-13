import { describe, expect, it } from "vitest";
import {
  coordKey,
  displacedUrls,
  EMPTY_SPIDER,
  leafOffsets,
  leafPositions,
  type Projection,
  SPIDERFY_ZOOM,
  sameStacks,
  spiderData,
  stacksFrom,
} from "./spiderfy";

const pin = (url: string, lng: number, lat: number, salience = 1, date = "20260814000000") => ({
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { url, salience, date, kind: "PIN" },
});

const flat = (scale = 1): Projection => ({
  project: ([lng, lat]) => ({ x: lng * scale, y: -lat * scale }),
  unproject: ([x, y]) => ({ lng: x / scale, lat: -y / scale }),
});

describe("stacksFrom", () => {
  it("groups only stories at exactly the same coordinate", () => {
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
    expect(y).toBeLessThan(0);
  });

  it("keeps every leaf clear of the anchor's own disc", () => {
    for (const count of [2, 5, 8, 14]) {
      for (const [x, y] of leafOffsets(count)) {
        expect(Math.hypot(x, y)).toBeGreaterThan(32);
      }
    }
  });

  it("spirals past eight rather than crowding one ring", () => {
    const offsets = leafOffsets(14);
    expect(offsets).toHaveLength(14);
    const radii = offsets.map(([x, y]) => Math.hypot(x, y));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it("keeps even the biggest stack near the city it belongs to", () => {
    for (const [x, y] of leafOffsets(14)) expect(Math.hypot(x, y)).toBeLessThan(140);
  });

  it("never repeats a bearing, so legs do not stack into spokes", () => {
    const bearings = leafOffsets(14).map(([x, y]) =>
      Math.round((Math.atan2(y, x) * 180) / Math.PI)
    );
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
    const [leaf] = spiderData(stacks, flat()).features.filter((f) => f.geometry.type === "Point");
    expect(leaf.properties).toMatchObject({ url: "mid", kind: "PIN", salience: 2 });
  });

  it("hands the top-5 flag to the leaf as a property", () => {
    const data = spiderData(stacks, flat(), ["weak"]);
    const flags = data.features
      .filter((f) => f.geometry.type === "Point")
      .map((f) => [f.properties?.url, f.properties?.top]);
    expect(flags).toEqual([
      ["mid", 0],
      ["weak", 1],
    ]);
  });

  it("hands the selection to the leaf the same way", () => {
    const data = spiderData(stacks, flat(), [], "weak");
    const flags = data.features
      .filter((f) => f.geometry.type === "Point")
      .map((f) => [f.properties?.url, f.properties?.selected]);
    expect(flags).toEqual([
      ["mid", 0],
      ["weak", 1],
    ]);
  });

  it("marks nothing selected when nothing is open", () => {
    const [leaf] = spiderData(stacks, flat()).features.filter((f) => f.geometry.type === "Point");
    expect(leaf.properties?.selected).toBe(0);
  });

  it("keeps the spider the same size in PIXELS at any zoom", () => {
    const near = spiderData(stacks, flat(1));
    const far = spiderData(stacks, flat(4));
    const first = (data: typeof near) =>
      (
        data.features.find((f) => f.geometry.type === "Point")!.geometry as unknown as {
          coordinates: [number, number];
        }
      ).coordinates;
    const [nearLng] = first(near);
    const [farLng] = first(far);
    expect(Math.abs(nearLng - 10)).toBeCloseTo(4 * Math.abs(farLng - 10), 6);
  });

  it("draws nothing for no stacks", () => {
    expect(spiderData([], flat())).toEqual(EMPTY_SPIDER);
  });
});

describe("leafPositions", () => {
  const stacks = stacksFrom([
    pin("strong", 10, 20, 4),
    pin("mid", 10, 20, 2),
    pin("weak", 10, 20, 1),
  ]);

  it("returns one entry per displaced member and none for the best member", () => {
    const positions = leafPositions(stacks, flat());
    expect([...positions.keys()].sort()).toEqual(["mid", "weak"]);
    expect(positions.has("strong")).toBe(false);
  });

  it("agrees with the leaf coordinates spiderData draws", () => {
    const positions = leafPositions(stacks, flat());
    const leaves = spiderData(stacks, flat()).features.filter((f) => f.geometry.type === "Point");
    for (const leaf of leaves) {
      const url = leaf.properties?.url as string;
      const coordinates = (leaf.geometry as unknown as { coordinates: [number, number] })
        .coordinates;
      expect(positions.get(url)).toEqual(coordinates);
    }
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
    expect(displacedUrls(stacks)).toEqual(new Set(["b", "c", "e"]));
  });

  it("is empty when there are no spiders, so nothing is withheld", () => {
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
    expect(SPIDERFY_ZOOM).toBe(9);
  });

  it("keys a coordinate exactly, the same way on both sides", () => {
    expect(coordKey(-87.65, 41.85)).toBe("-87.65,41.85");
    expect(coordKey(-87.65, 41.85)).not.toBe(coordKey(-87.6500001, 41.85));
  });
});
