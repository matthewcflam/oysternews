/**
 * The browser's half of Mode 3's "Zoom to Texas": the per-region bounding boxes,
 * and the camera fit computed from one.
 *
 * **The table is static and committed**, unlike the story index — it is built by
 * `scripts/build-boundaries.ts` from the same Natural Earth features the outline
 * archive is built from, so every id in it is an id the outline can draw. That
 * is why it is addressed relative to the origin (`/region-bbox.json`) rather
 * than through the manifest: it does not change between runs, and a run must not
 * be able to invalidate the map's geography.
 *
 * **Fetched lazily, on the first label click**, for the same reason the index is:
 * ~140 KB that nothing needs until a region panel opens, on an audience §1 puts
 * on a phone. Bundling it would put it in the initial JS payload, where it would
 * delay the one thing that has to be fast — the map appearing.
 */

/** `[west, south, east, north]`. West may exceed east — see `MAX_FIT_ZOOM`. */
export type Bbox = [number, number, number, number];

export type BboxTable = Record<string, Bbox>;

export const BBOX_URL = "/region-bbox.json";

let pending: Promise<BboxTable> | null = null;

/**
 * Fetch the table once, however many clicks ask for it.
 *
 * Memoized on the promise rather than the result so two fast clicks share one
 * request instead of racing two. Not keyed by URL, unlike `loadRegionIndex` —
 * there is only one URL and it is immutable for the life of a deploy.
 *
 * A failed fetch clears the cache so the next click retries rather than
 * re-throwing a network blip for the rest of the session.
 */
export function loadRegionBboxes(): Promise<BboxTable> {
  if (!pending) {
    pending = fetch(BBOX_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`region bbox: HTTP ${response.status}`);
        return (await response.json()) as BboxTable;
      })
      .catch((cause: unknown) => {
        pending = null;
        throw cause;
      });
  }
  return pending;
}

/** Test seam. */
export function resetRegionBboxCache(): void {
  pending = null;
}

/**
 * How far in a fit is allowed to go.
 *
 * **A small region would otherwise land past the archive's own ceiling.** The
 * stories archive is built to z12 (§3.1); fitting Singapore or Delaware to a
 * 900px viewport asks for z11-14, and above z12 MapLibre overzooms the last real
 * tile — the pins get bigger and no new stories appear, which reads as the map
 * having run out of news. Stopping at 9 keeps a region's own pins in view with
 * its neighbours around them, which is what the button is for.
 */
export const MAX_FIT_ZOOM = 9;

/** Breathing room around the fitted box, so a coastline is not flush to the edge. */
export const FIT_PADDING = 48;

/**
 * A region's box, or `null` when the table does not carry it.
 *
 * `null` is a normal answer, and the panel hides the button rather than
 * offering one that does nothing: Natural Earth writes no polygon for a handful
 * of ids the story pipeline can still produce (`IN25` was one until the override
 * landed — see `ADM1_FIPS_OVERRIDES`), and the story index and the boundary set
 * are two different files that will never agree perfectly.
 *
 * The box is validated rather than trusted. It is fetched JSON, it is the input
 * to a camera move, and `fitBounds` on a `NaN` leaves the map somewhere the
 * reader cannot recover from without a reload.
 */
export function bboxFor(table: BboxTable | null, regionId: string): Bbox | null {
  if (!table || !regionId) return null;
  const box = table[regionId];
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  // A degenerate box — a region reduced to a point by a bad join — would fit to
  // maximum zoom on an arbitrary coordinate.
  if (box[2] <= box[0] || box[3] <= box[1]) return null;
  return box as Bbox;
}
