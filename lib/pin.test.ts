import { describe, expect, it } from "vitest";
import { MARK } from "./layers";
import { PIN_HEIGHT, PIN_LEFT_PAD, PIN_PIXEL_RATIO, PIN_WIDTH, trianglePin } from "./pin";

/** Alpha of the pixel at `(x, y)`. */
const alphaAt = (
  image: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number,
): number => image.data[(y * image.width + x) * 4 + 3];

/** The alpha of every pixel in a row, left to right. */
const row = (image: { width: number; data: Uint8ClampedArray }, y: number): number[] =>
  [...Array(image.width).keys()].map((x) => alphaAt(image, x, y));

describe("trianglePin", () => {
  it("rasterises at the requested device size", () => {
    const image = trianglePin(52, 34, 2);
    expect(image.width).toBe(104);
    expect(image.height).toBe(68);
    expect(image.data.length).toBe(104 * 68 * 4);
  });

  it("defaults to the exported size and pixel ratio", () => {
    const image = trianglePin();
    expect(image.width).toBe(PIN_WIDTH * PIN_PIXEL_RATIO);
    expect(image.height).toBe(PIN_HEIGHT * PIN_PIXEL_RATIO);
  });

  /**
   * The whole contract of the shape, and the reason `selectedPinLayer` can anchor
   * `bottom`: the point is the middle of the bottom edge. If this drifts, the
   * wedge points somewhere near the story instead of at it.
   */
  it("puts the point at the middle of the bottom edge", () => {
    const image = trianglePin(52, 34, 1);
    const bottom = row(image, image.height - 1);
    const drawn = bottom.map((alpha, x) => ({ alpha, x })).filter(({ alpha }) => alpha > 0);

    expect(drawn.length).toBeGreaterThan(0);
    // Everything still drawn on the last row is within a pixel of the centre.
    for (const { x } of drawn) {
      expect(Math.abs(x - image.width / 2)).toBeLessThanOrEqual(2);
    }
  });

  it("has a flat top edge, inset by the padding that centres the apex", () => {
    const image = trianglePin(52, 34, 1);
    const top = row(image, 0);
    const first = top.findIndex((alpha) => alpha > 0);

    // Solid from the padding across to the right edge — this is the wide end.
    expect(first).toBeGreaterThan(0);
    expect(Math.abs(first - image.width * PIN_LEFT_PAD)).toBeLessThanOrEqual(2);
    // Solid across to the right edge. The last column is only partly covered:
    // the steep side starts leaning in immediately, within that first row.
    expect(alphaAt(image, image.width - 4, 0)).toBe(255);
    expect(alphaAt(image, image.width - 1, 0)).toBeGreaterThan(0);
    // And the padding itself is empty.
    expect(alphaAt(image, 0, 0)).toBe(0);
  });

  it("narrows from top to bottom", () => {
    const image = trianglePin(52, 34, 1);
    const widthAt = (y: number) => row(image, y).filter((alpha) => alpha > 0).length;

    expect(widthAt(0)).toBeGreaterThan(widthAt(image.height / 2));
    expect(widthAt(image.height / 2)).toBeGreaterThan(widthAt(image.height - 1));
  });

  /**
   * Without antialiasing the two slopes are staircases at the size this mark is
   * drawn at. A partial alpha on each side is the cheapest possible proof that
   * the coverage sampling is running at all.
   */
  it("antialiases both slopes", () => {
    const image = trianglePin(52, 34, 1);
    const middle = row(image, Math.round(image.height / 2));
    const partial = middle.filter((alpha) => alpha > 0 && alpha < 255);

    expect(partial.length).toBeGreaterThan(0);
  });

  /** One purple, taken from `lib/layers.ts` so it cannot drift. */
  it("paints every pixel in the brand mark colour", () => {
    const image = trianglePin(8, 6, 1);
    const value = Number.parseInt(MARK.slice(1), 16);
    const expected = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

    for (let i = 0; i < image.data.length; i += 4) {
      expect([image.data[i], image.data[i + 1], image.data[i + 2]]).toEqual(expected);
    }
  });
});
