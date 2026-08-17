import { describe, expect, it } from "vitest";
import { bboxesById } from "./build-boundaries.ts";

/**
 * The bbox table behind Mode 3's "Zoom to Texas".
 *
 * **These exist because the failure is silent and geographic.** A wrong bbox
 * does not throw; it flies the camera to the middle of the Pacific, or zooms
 * *out* to the whole world, and the button looks broken rather than the data
 * looking wrong. The antimeridian cases below are the three the plan named as
 * live gates — Russia, Fiji and the United States — reduced to their essential
 * shapes so they can be checked without 54 MB of Natural Earth.
 */

const feature = (id: string, ring: [number, number][]) => ({
  type: "Feature" as const,
  geometry: { type: "Polygon", coordinates: [ring] },
  properties: { id },
});

describe("bboxesById", () => {
  it("bounds an ordinary region from its own coordinates", () => {
    const boxes = bboxesById([
      feature("IN", [
        [68, 6],
        [97, 6],
        [97, 35],
        [68, 35],
      ]),
    ]);
    expect(boxes.IN).toEqual([68, 6, 97, 35]);
  });

  /**
   * The union, not the first match. Natural Earth splits a great many regions
   * into features that each carry the parent's code; taking the first would zoom
   * to one province and call it the region.
   */
  it("unions every feature sharing an id", () => {
    const boxes = bboxesById([
      feature("SP", [
        [-9, 36],
        [-3, 36],
        [-3, 43],
        [-9, 43],
      ]),
      feature("SP", [
        [-18, 27],
        [-13, 27],
        [-13, 29],
        [-18, 29],
      ]),
    ]);
    expect(boxes.SP).toEqual([-18, 27, -3, 43]);
  });

  /**
   * **The trap.** Naively, Fiji's longitudes span -180 to 180 and the box is the
   * whole planet. The correct box crosses the antimeridian, so east runs past
   * 180 rather than wrapping back to a negative number.
   */
  it("crosses the antimeridian rather than bounding the planet", () => {
    const boxes = bboxesById([
      feature("FJ", [
        [177, -18],
        [-179, -18],
        [-179, -16],
        [177, -16],
      ]),
    ]);
    expect(boxes.FJ).toEqual([177, -18, 181, -16]);
    // The naive answer, and the one that would fly the camera to the Atlantic.
    expect(boxes.FJ).not.toEqual([-179, -18, 177, -16]);
  });

  /** Russia's real shape: 19°E to 169°W, which is the narrow arc going east. */
  it("picks the narrow arc for a country that spans most of a hemisphere", () => {
    const boxes = bboxesById([
      feature("RS", [
        [19, 41],
        [-169, 41],
        [-169, 81],
        [19, 81],
      ]),
    ]);
    const [west, , east] = boxes.RS;
    expect(west).toBe(19);
    expect(east).toBe(191);
    expect(east - west).toBeLessThan(180);
  });

  /**
   * The United States: mainland plus the Aleutians on the far side of 180. The
   * shifted frame wins, and west stays inside [-180, 180) while east runs past
   * it — the form `fitBounds` reads directly under `renderWorldCopies`.
   */
  it("keeps west in range and lets east run past 180", () => {
    const boxes = bboxesById([
      feature("US", [
        [-125, 25],
        [-67, 25],
        [-67, 49],
        [-125, 49],
      ]),
      feature("US", [
        [172, 51],
        [179, 51],
        [179, 53],
        [172, 53],
      ]),
    ]);
    const [west, , east] = boxes.US;
    expect(west).toBe(172);
    expect(east).toBe(293);
    expect(west).toBeGreaterThanOrEqual(-180);
    expect(west).toBeLessThan(180);
  });

  it("walks a MultiPolygon as readily as a Polygon", () => {
    const boxes = bboxesById([
      {
        type: "Feature" as const,
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            ],
            [
              [
                [5, 5],
                [6, 5],
                [6, 6],
                [5, 6],
              ],
            ],
          ],
        },
        properties: { id: "XX" },
      },
    ]);
    expect(boxes.XX).toEqual([0, 0, 6, 6]);
  });

  it("skips a feature with no id rather than making an empty key", () => {
    const boxes = bboxesById([
      feature("", [
        [0, 0],
        [1, 1],
      ]),
    ]);
    expect(boxes).toEqual({});
  });
});
