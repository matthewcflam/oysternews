/**
 * The selection triangle, rasterised in plain TypeScript rather than an
 * SVG/PNG asset — this repo has no binary image assets, so a colour that
 * lived in both a sprite and the palette would drift, and rasterising in
 * code makes the shape assertable in `lib/pin.test.ts`. A wedge with a
 * flat top and point at the bottom, same silhouette as a bubble's tail.
 * The apex sits at the image's horizontal centre via left padding
 * (`PIN_LEFT_PAD`), not `icon-offset`, keeping `icon-anchor: "bottom"`
 * correct by construction.
 */

import { MARK } from "./layers";

/** The image's size in CSS pixels, padding included. */
export const PIN_WIDTH = 30;
export const PIN_HEIGHT = 34;

/** Where the wedge's top edge starts, as a share of width — everything left is transparent padding, which makes W/2 the apex. */
export const PIN_LEFT_PAD = 0.2;

/** Rasterised at 2x for clean sloped edges on a retina phone (1x visibly stairsteps). */
export const PIN_PIXEL_RATIO = 2;

/** Subsamples per axis for pixel coverage — 4 gives 16 alpha levels per slope, past where the edge reads as smooth. */
const SUBSAMPLES = 4;

/** `#RRGGBB` to a byte triple. Throws rather than guessing — see `MARK`. */
const rgb = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`pin: expected #RRGGBB, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

// How much of the pixel at (x, y) the wedge covers, in [0, 1]. The top
// edge is horizontal, so at any height the wedge is one interval — two
// comparisons rather than three half-plane cross products.
const coverage = (x: number, y: number, width: number, height: number): number => {
  const apex = width / 2;
  const start = width * PIN_LEFT_PAD;
  let inside = 0;

  for (let sy = 0; sy < SUBSAMPLES; sy++) {
    // Subpixel CENTRES, not corners — a corner sample landing on an edge
    // would call an empty pixel 25% covered.
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

// The wedge as an ImageData-shaped object, ready for map.addImage. RGBA is
// NOT premultiplied — MapLibre expects that, so colour bytes are written
// at full strength and only alpha carries the coverage.
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
