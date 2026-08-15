import { describe, expect, it } from "vitest";
import { NEARBY_RADIUS_PX, nearbyBox, nearbyStories } from "./nearby";

const feature = (url: string, salience: number, title = url) => ({
  properties: { url, title, source: "x.test", place: "Houston, Texas, United States", kind: "PIN", date: "20260813193400", salience },
});

describe("nearbyStories", () => {
  it("excludes the story that was clicked", () => {
    const found = nearbyStories(
      [feature("https://a.test/1", 3), feature("https://b.test/2", 2)],
      "https://a.test/1",
    );
    expect(found.map((story) => story.url)).toEqual(["https://b.test/2"]);
  });

  it("orders by salience, not by the order the map returned them", () => {
    // Every feature here is already near the click — that is what the radius
    // query decided — so distance no longer separates them usefully, and
    // ordering by it would put an arbitrary two-pixel difference ahead of the
    // §2.5 ranking the whole pipeline exists to compute.
    const found = nearbyStories(
      [feature("https://a.test/1", 0.7), feature("https://b.test/2", 4.2), feature("https://c.test/3", 2.1)],
      "https://z.test/none",
    );
    expect(found.map((story) => story.url)).toEqual([
      "https://b.test/2",
      "https://c.test/3",
      "https://a.test/1",
    ]);
  });

  it("dedupes by url", () => {
    // §2.4 draws the country floor and the stories layer over each other by
    // design, so one story is routinely rendered in both source layers.
    const found = nearbyStories(
      [feature("https://a.test/1", 3), feature("https://a.test/1", 3)],
      "https://z.test/none",
    );
    expect(found).toHaveLength(1);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => feature(`https://a.test/${i}`, i));
    expect(nearbyStories(many, "https://z.test/none")).toHaveLength(6);
    expect(nearbyStories(many, "https://z.test/none", 2)).toHaveLength(2);
  });

  it("skips features the panel could not render", () => {
    // A feature with no url has no identity; §2.6's content model refuses it.
    const found = nearbyStories(
      [{ properties: { title: "no url" } }, { properties: null }, feature("https://a.test/1", 1)],
      "https://z.test/none",
    );
    expect(found.map((story) => story.url)).toEqual(["https://a.test/1"]);
  });

  it("treats an empty neighbourhood as a normal answer", () => {
    // §2.4's budget thins features at low zoom, so a quiet part of the world
    // genuinely has no neighbours drawn. The panel renders this, not an error.
    expect(nearbyStories([], "https://a.test/1")).toEqual([]);
  });

  it("carries no field the panel may not render", () => {
    const [story] = nearbyStories([feature("https://a.test/1", 3)], "https://z.test/none");
    expect(Object.keys(story).sort()).toEqual(["date", "kind", "place", "source", "title", "url"]);
  });
});

describe("nearbyBox", () => {
  it("squares the radius around the tap", () => {
    expect(nearbyBox({ x: 100, y: 200 }, 10)).toEqual([
      [90, 190],
      [110, 210],
    ]);
  });

  it("defaults to the pin-sized radius", () => {
    const [[left]] = nearbyBox({ x: 100, y: 200 });
    expect(left).toBe(100 - NEARBY_RADIUS_PX);
  });
});
