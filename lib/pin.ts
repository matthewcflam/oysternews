/**
 * The selection triangle, rasterised in plain TypeScript.
 *
 * **Why not an SVG or a PNG.** This repo has no image assets, no sprite sheet and
 * no other `addImage` call — the only symbol layer it has ever had is text.
 * Adding the first binary asset would mean a build step to keep it in sync with
 * the palette, and a colour that lives in two files drifts. Sixty lines of
 * arithmetic import the colour instead, and the shape becomes something `vitest`
 * can assert (`lib/pin.test.ts`) rather than something a reviewer has to open in
 * a browser.
 *
 * **The shape.** A wedge with a flat top and its point at the bottom — the same
 * silhouette as a speech bubble's tail, which is the other thing on this map that
 * points at a story:
 *
 * ```
 *          (Lw,0) ┌──────────────┐ (W,0)     top edge:  flat, from Lw to W
 *                  ╲            ╱            left edge: gentle
 *                   ╲          ╱             right edge: steep
 *                    ╲        ╱
 *                     ╲      ╱               the point at (W/2, H) is what
 *                      ╲    ╱                lands on the map coordinate
 *                       ╲  ╱
 *              (W/2,H)   ╲╱
 * ```
 *
 * It replaced a right triangle whose point was the bottom-right corner: that one
 * read as a corner of something rather than as an arrow, and at 40px it was hard
 * to tell which of its three corners was doing the pointing.
 *
 * **The apex sits at the image's horizontal centre, and the padding on the left
 * is what puts it there.** The drawn wedge is asymmetric — its point is about
 * 37% along its own top edge, which is what gives it the lean — but an off-centre
 * apex would need `icon-offset` to land on the coordinate, and `icon-offset` is
 * expressed in `lib/layers.ts`, which `lib/pin.ts` already imports from. Padding
 * a few transparent columns instead keeps `icon-anchor: "bottom"` correct by
 * construction and the two modules pointing one way.
 */

import { MARK } from "./layers";

/** The image's size in CSS pixels, padding included. */
export const PIN_WIDTH = 30;
export const PIN_HEIGHT = 34;

/**
 * Where the wedge's top edge starts, as a share of the width. Everything left of
 * it is transparent padding, and it is what makes `W/2` the apex — see the
 * header. The drawn top edge is the remaining 0.8W.
 */
export const PIN_LEFT_PAD = 0.2;

/**
 * Rasterised at 2× and handed to `addImage` with a matching `pixelRatio`, so the
 * sloped edges are still clean on a retina phone — which is §1's whole audience.
 * At 1× the antialiasing below has half as many steps to work with and the slopes
 * visibly stairstep.
 */
export const PIN_PIXEL_RATIO = 2;

/**
 * Subsamples per axis when measuring how much of a pixel the wedge covers.
 * 4 gives 16 levels of alpha along each slope, which is past the point where the
 * edge reads as smooth and well short of where the extra work shows up.
 */
const SUBSAMPLES = 4;

/** `#RRGGBB` to a byte triple. Throws rather than guessing — see `MARK`. */
const rgb = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`pin: expected #RRGGBB, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

/**
 * How much of the pixel at `(x, y)` the wedge covers, in `[0, 1]`.
 *
 * The top edge is horizontal, so at any height the wedge is one interval: it
 * narrows from `[Lw, W]` at the top to the single point `W/2` at the bottom, and
 * both ends move linearly. That makes the test two comparisons rather than three
 * half-plane cross products.
 */
const coverage = (x: number, y: number, width: number, height: number): number => {
  const apex = width / 2;
  const start = width * PIN_LEFT_PAD;
  let inside = 0;

  for (let sy = 0; sy < SUBSAMPLES; sy++) {
    // Sample at subpixel CENTRES, not corners: a sample landing exactly on an
    // edge would call an empty pixel 25% covered.
    const py = y + (sy + 0.5) / SUBSAMPLES;
    const ratio = py / height;
    const left = start + (apex - start) * ratio;
    const right = width + (apex - width) * ratio;

    for (let sx = 0; sx < SUBSAMPLES; sx++) {
      const px = x + (sx + 0.5) / SUBSAMPLES;
      if (px >= left && px <= right) inside++;
    }
  }

  return inside / (SUBSAMPLES * SUBSAMPLES);
};

/**
 * The wedge as an `ImageData`-shaped object, ready for `map.addImage`.
 *
 * RGBA is **not premultiplied** — that is what MapLibre expects from an
 * `ImageData`, and it is why the colour bytes are written at full strength on
 * every pixel and only the alpha carries the coverage.
 */
export function trianglePin(
  cssWidth: number = PIN_WIDTH,
  cssHeight: number = PIN_HEIGHT,
  pixelRatio: number = PIN_PIXEL_RATIO,
): { width: number; height: number; data: Uint8ClampedArray } {
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  const [r, g, b] = rgb(MARK);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = Math.round(coverage(x, y, width, height) * 255);
    }
  }

  return { width, height, data };
}
