"use client";

import { useEffect, useRef, useState } from "react";
import {
  MapLibreMap,
  NavigationControl,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
  type ErrorEvent,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, basemap } from "@/lib/basemap";
import { firstLabel, labelAnchor, labelName } from "@/lib/labels";
import {
  BOUNDARIES_ARCHIVE,
  BOUNDARIES_SOURCE_ID,
  CLICKABLE_LAYER_IDS,
  COUNTRY_LAYER_ID,
  COUNTRY_OUTLINE_ID,
  COUNTRY_SOURCE_LAYER,
  HIT_LAYER_FOR,
  LABELS_LAYER_ID,
  MATCH_NOTHING,
  OUTLINE_LAYER_FOR,
  PIN_IMAGE_ID,
  REGION_OUTLINE_ID,
  SELECTED_SOURCE_ID,
  SELECTED_STATE_KEY,
  SOURCE_ID,
  SPIDER_SOURCE_ID,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
  TOP_LAYER_ID,
  TOP_STATE_KEY,
  boundaryLayers,
  bubbleLabelFilter,
  firstPlaceLabelLayerId,
  hitLayers,
  matchId,
  outlineFor,
  selectedPinLayer,
  spiderLayers,
  storyLayers,
  topFilter,
  topPinLayer,
} from "@/lib/layers";
import { loadManifest } from "@/lib/manifest";
import { PIN_PIXEL_RATIO, trianglePin } from "@/lib/pin";
import {
  FIT_PADDING,
  MAX_FIT_ZOOM,
  bboxFor,
  loadRegionBboxes,
  type BboxTable,
} from "@/lib/region-bbox";
import { entryFor, loadRegionIndex } from "@/lib/regions";
import { panelStory, type PanelStory } from "@/lib/story";
import {
  EMPTY_SPIDER,
  SPIDERFY_ZOOM,
  displacedUrls,
  sameStacks,
  spiderData,
  stacksFrom,
  type Stack,
} from "@/lib/spiderfy";
import { sameKeys, topKeys } from "@/lib/top";
import type { RegionIndex } from "@/lib/types";
import MapTilerLogo from "./MapTilerLogo";
import RegionPanel from "./RegionPanel";
import StoryBubbles, { type TopStory } from "./StoryBubbles";
import StoryPanel from "./StoryPanel";

/**
 * The map (HANDOFF.md §4). This component owns wiring only — the source, the
 * camera, and the click behaviour. **How the layers look lives in
 * `lib/layers.ts`**, because those specs encode product rules (§2.6 link-out,
 * §2.3's invisible tier-1 preference, containers drawn as regions) that are
 * worth testing rather than reviewing.
 *
 * The archive is whatever `manifest.json` currently points at, which changes
 * every run — hence the async step before a source can be added.
 *
 * MapLibre 6 has no default export and aliases its Map class to avoid shadowing
 * the global `Map`, hence the named `MapLibreMap` import.
 */

/**
 * MapLibre 6 builds its worker from a Blob that does `import "<runtime url>"`,
 * which Turbopack cannot resolve. Left alone the worker silently 404s and the map
 * paints the basemap background but never loads a source or requests a tile — no
 * error event, no console warning. Pointing at the copy that `predev`/`prebuild`
 * place in public/ (scripts/copy-maplibre-worker.mjs) is the supported fix.
 */
const WORKER_URL = "/maplibre-gl-worker.mjs";

/** What a label click resolved to: an id the outline archive can draw, and a heading. */
type Selection = { id: string; name: string };

const NO_PIN: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Drop the selection triangle at a coordinate, or clear it with `null`.
 *
 * A one-feature GeoJSON source rather than a `Marker`: a marker is a DOM node
 * positioned on every frame of every drag, and this has to survive the same pans
 * and zooms the pins do. As a source it moves with the map for free, at the same
 * moment the pin under it moves — a marker lags it by a frame, which at the tip
 * of a triangle is visible as the point sliding off its own dot.
 */
const showPin = (map: MapLibreMap | null, at: [number, number] | null) => {
  const source = map?.getSource<GeoJSONSource>(SELECTED_SOURCE_ID);
  if (!source) return;
  source.setData(
    at
      ? {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} }],
        }
      : NO_PIN,
  );
};

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /**
   * The same map as `mapRef`, in state, purely so the overlay re-renders once it
   * exists. A ref is invisible to React, and `StoryBubbles` has to subscribe to
   * the map's events the moment there is a map to subscribe to.
   */
  const [ready, setReady] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = basemap().provider;

  /**
   * The selected story.
   *
   * **This is what the map popup used to be.** A click no longer anchors a box to
   * the dot it hit; it opens the panel, which is the same slot §2.3's region
   * panel uses. Holding the selection in React state rather than in a MapLibre
   * `Popup` is what lets the panel be a component with a testable content model
   * (`lib/story.ts`) instead of an HTML string.
   *
   * **`nearby` went with "Stories Nearby" (2026-08-16).** The card's list is
   * "More Reporting" — other outlets on the same story — and that rides the
   * story's own `more` field rather than a second `queryRenderedFeatures` over a
   * radius. So the state, the radius query, `lib/nearby.ts` and its test are all
   * deleted rather than left wired to nothing, the same treatment `samePlacement`
   * and `anchorBubbles` got when they were orphaned.
   */
  const [story, setStory] = useState<PanelStory | null>(null);

  /**
   * The open story's url, and the spider's redraw, both held for `markSelected`.
   *
   * The url is a ref rather than derived from `story` because the two readers of
   * it — the feature state on the vector source and the leaf property on the
   * overlay — are both written from map code, outside React's ordering. Reading
   * it off state would paint the disc a render late, which is a frame in which
   * the wedge is pointing at an orange circle.
   *
   * `redrawSpider` is the map effect handing out its own `drawSpider`, because a
   * leaf's fill is data and data only changes when the overlay is rebuilt. A
   * click does not move the camera, so nothing else would rebuild it until the
   * reader's next gesture.
   */
  const selectedUrl = useRef<string | null>(null);
  const redrawSpider = useRef<(() => void) | null>(null);

  /**
   * Mode 1's speech bubbles: the five stories the ring marks **on arrival**,
   * with their headlines and the coordinate each tail has to land on.
   *
   * **Written exactly twice.** Once at the first `idle`, where the ranking is
   * taken over the default world view and is therefore the top five stories in
   * the world; and once, back to empty, on the reader's first camera move. The
   * bubbles are the map's opening sentence, not a live caption that follows the
   * reader — see `dismissBubbles`. The ring goes on re-ranking to the viewport
   * at every idle, which is where "what is big here" keeps being answered.
   */
  const [tops, setTops] = useState<TopStory[]>([]);

  /*
   * **The collapse tab is gone (2026-08-16), and so is the state behind it.**
   *
   * `PanelTab`, `collapsed` and `onToggleCollapse` existed to slide a full-height
   * column off the left edge so the reader could see the map underneath it. Mode
   * 2 made the panel a 324x489 card that covers about a twelfth of a desktop
   * viewport — there is no longer anything worth reclaiming, and a control whose
   * whole purpose was reclaiming it is a control that answers a question nobody
   * has.
   *
   * **Dismissal did not go with it**, which is the part that would have been easy
   * to lose: the tab and the × answered different questions, and only the tab's
   * question expired. There are three ways to close a panel — `Escape` below, a
   * click on the map background (the miss path in the click handler), and the ×
   * in the card itself.
   */

  /**
   * §2.3's region panel. `regionsUrl` is optional on the manifest — one
   * published before 2026-08-13 has none — so `null` here means the panel is
   * unavailable, not broken, and the map must go on working without it.
   */
  const [regionsUrl, setRegionsUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [index, setIndex] = useState<RegionIndex | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);

  /**
   * Mode 3's "Zoom to Texas" table. Committed and static, so it has no
   * `unavailable` state of its own: a failed fetch leaves this `null`, and the
   * panel simply does not draw the button. There is nothing to tell the reader —
   * the map is fine and the two other ways to reach a region (drag, wheel) are
   * the ones they were already using.
   */
  const [bboxes, setBboxes] = useState<BboxTable | null>(null);

  /**
   * Clear the outline and the selection pin from outside the map effect — the
   * panel's close button.
   *
   * The triangle is torn down here, alongside the outline, because the two are
   * the same statement: "this is the thing you picked". Clearing one without the
   * other leaves the map pointing at something the panel is no longer showing.
   */
  /**
   * Move the `MARK` fill onto one story's disc, or take it off with `null`.
   *
   * **Both source layers**, for the reason `setTop` gives: the flag has to
   * survive the z4 handover from the country floor to the stories layer without
   * a repaint gap. The top-5 copy on top reads the same source and the same
   * state, so it recolours with the original underneath it.
   *
   * The spider is redrawn last because a leaf carries the flag as data, not as
   * state. Cheap: it is the same rebuild `drawSpider` does on every zoom step.
   */
  const markSelected = (url: string | null) => {
    const map = mapRef.current;
    const previous = selectedUrl.current;
    selectedUrl.current = url;
    if (!map) return;

    for (const sourceLayer of [STORIES_SOURCE_LAYER, COUNTRY_SOURCE_LAYER]) {
      if (previous) {
        map.removeFeatureState({ source: SOURCE_ID, sourceLayer, id: previous }, SELECTED_STATE_KEY);
      }
      if (url) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer, id: url },
          { [SELECTED_STATE_KEY]: true },
        );
      }
    }

    redrawSpider.current?.();
  };

  const clearRegion = () => {
    setSelection(null);
    markSelected(null);
    showPin(mapRef.current, null);
    for (const id of [COUNTRY_OUTLINE_ID, REGION_OUTLINE_ID]) {
      if (mapRef.current?.getLayer(id)) mapRef.current.setFilter(id, MATCH_NOTHING);
    }
  };

  /**
   * Fly the camera to the selected region's bounds.
   *
   * **This is the zoom §2.3 deliberately took OUT of the label click, put back
   * as a thing the reader asks for.** Clicking a label used to move the camera;
   * that was removed because the panel answers the question directly and the
   * move was one nobody requested. A button is the other half of that argument —
   * the reader who does want to go there now has a way to say so, and the
   * reader who does not is still left where they were.
   *
   * The panel stays open and the outline stays drawn: the region is still the
   * selection, and closing the thing that explains where you just flew to would
   * be a strange reward for pressing it.
   *
   * `fitBounds`, not `flyTo` with a computed zoom: the box is the datum, and
   * asking MapLibre to fit it accounts for the viewport's aspect ratio, which a
   * zoom number cannot. `MAX_FIT_ZOOM` is why a small region does not overshoot
   * the archive's z12 ceiling.
   */
  const zoomToRegion = () => {
    const map = mapRef.current;
    const box = bboxFor(bboxes, selection?.id ?? "");
    if (!map || !box) return;

    map.fitBounds(
      [
        [box[0], box[1]],
        [box[2], box[3]],
      ],
      { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM },
    );
  };

  /**
   * Close the story panel and drop the container outline it drew.
   *
   * Shares `clearRegion`'s outline clearing rather than duplicating it: §2.2
   * allows exactly one outline on the map, so "no story selected" and "no region
   * selected" have to mean the same thing about the outline layers.
   */
  const clearStory = () => {
    setStory(null);
    clearRegion();
  };

  /**
   * Open a story: the panel, its neighbours, and the triangle on its coordinate.
   *
   * **One path for two gestures.** A pin click and a bubble click select the
   * same thing and must leave the map in the same state — the risk of two copies
   * is not that either is wrong today, but that one of them later grows a step
   * the other does not and the map starts behaving differently depending on
   * which half of the same mark the reader hit.
   *
   * `at` is where the triangle goes. It took a second argument, the screen point
   * the neighbours were measured from, until "Stories Nearby" was replaced by
   * "More Reporting" on 2026-08-16 — the card's list is a property of the story
   * rather than of where on the map it was clicked, so there is nothing left to
   * measure a radius from.
   */
  const selectStory = (selected: PanelStory, at: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;

    /**
     * **Every selection starts from a clean slate**, which settles the one
     * question §2.3 left open: a container click clears a region lock. There is
     * one red outline and one panel, and a container outline drawn while a
     * region outline is still up would leave the user unable to say which of the
     * two the map is claiming is selected.
     */
    clearRegion();
    showPin(map, at);
    // After `clearRegion`, which has just taken the fill off whatever was open.
    markSelected(selected.url);

    // §2.6 (link-out only) and §5.2 decision 3 (the pin half of the
    // geotag-confidence treatment) both live in `lib/story.ts`, where they are
    // tested rather than reviewed.
    setStory(selected);
  };

  /**
   * The index, fetched **lazily on first open**: ~151 KB gzipped, and nothing
   * needs it until a label is clicked (§1 — this audience is on a phone).
   */
  useEffect(() => {
    if (!selection || !regionsUrl || index) return;
    let cancelled = false;

    loadRegionIndex(regionsUrl)
      .then((loaded) => {
        if (!cancelled) setIndex(loaded);
      })
      .catch(() => {
        // Deliberately not the page-level error notice: the map is healthy and
        // every other part of it still works. The panel says so itself.
        if (!cancelled) setIndexFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [selection, regionsUrl, index]);

  /**
   * The bbox table, on the same trigger and for the same reason: ~140 KB that
   * nothing needs until a region panel is open.
   *
   * A separate effect from the index above rather than a second `then` inside
   * it, because the two are independent — the index comes from the manifest and
   * can be unavailable; this comes from the deploy and cannot. Chaining them
   * would make a missing `regionsUrl` also cost the reader the zoom button.
   */
  useEffect(() => {
    if (!selection || bboxes) return;
    let cancelled = false;

    loadRegionBboxes()
      .then((loaded) => {
        if (!cancelled) setBboxes(loaded);
      })
      .catch(() => {
        // Silent by design — see the `bboxes` state. The button is simply absent.
      });

    return () => {
      cancelled = true;
    };
  }, [selection, bboxes]);

  /**
   * `Escape` closes whichever panel is open.
   *
   * **One of the three dismissals, and the one that had never been wired.** The
   * card, the click-away and this were all listed together as the affordances
   * that survive the collapse tab's deletion; the other two already existed, and
   * this did not — it was assumed. Keyboard dismissal is also the only one of the
   * three a reader who never touches the mouse has.
   *
   * Bound only while something is open, so the map does not carry a global
   * keydown listener to do nothing with. `story` wins over `selection` in the
   * same order the render does — §2.3 allows one panel, and a story click clears
   * the region, so the two can only disagree for the frame in between.
   */
  useEffect(() => {
    if (!story && !selection) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (story) clearStory();
      else clearRegion();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `clearStory` and `clearRegion` are re-created every render and close over
    // nothing that outlives it; what decides whether the key is live is the
    // selection, which is what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, selection]);

  useEffect(() => {
    if (!container.current) return;

    setWorkerUrl(WORKER_URL);

    // PMTiles serves itself over HTTP range requests; registering the protocol
    // lets MapLibre address an archive with a pmtiles:// URL.
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);

    const map = new MapLibreMap({
      container: container.current,
      style: basemap().styleUrl,
      // z2, forced by MapTiler's country labels not existing below it — see
      // lib/basemap.ts. §2.3's gesture has to be clickable on arrival.
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      // §3.1: 2D Mercator, no globe projection.
      renderWorldCopies: true,
      attributionControl: { compact: false },
    });

    // Bottom-right (2026-08-14), not top-right: the freshness stamp took that
    // corner when the masthead was removed, and the two would overlap there.
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    setReady(map);

    /**
     * Dev-only test seam. §11 is this project's expensive lesson: it has shipped
     * green and rendered nothing, twice, and both times the missing tool was a
     * way to ask the running map what it actually did. `queryRenderedFeatures`
     * answers that in one line; guessing pixel coordinates does not.
     *
     * Stripped from production builds by the NODE_ENV check, which Next inlines
     * as a literal at build time, so this branch is not merely unreachable in
     * production — it is not in the bundle.
     */
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __sonderMap?: unknown }).__sonderMap = map;
    }

    /**
     * Two independent things have to finish before a source can be added: the
     * manifest fetch and the map's own `load`. Either can win. Awaiting both as
     * promises is the only ordering that is correct in both directions — an
     * `map.on("load")` handler that awaits inside itself would work too, but a
     * manifest that resolves first would then sit idle behind a network round
     * trip it already paid for.
     */
    const loaded = new Promise<void>((resolve) => {
      map.on("load", () => resolve());
    });

    // The effect can be torn down (StrictMode double-mount, navigation) while
    // both promises are still in flight. Touching a removed map throws.
    let cancelled = false;

    Promise.all([loadManifest(), loaded])
      .then(([manifest]) => {
        if (cancelled) return;

        map.addSource(SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${manifest.url}`,
          /**
           * Gives every story feature a stable id, which is what makes
           * `setFeatureState` — and therefore the top-5 highlight — possible at
           * all. Tippecanoe writes no feature ids, and without one MapLibre has
           * nothing to key state by.
           *
           * `url` is the only property unique per group (`worker/tiles.ts` does
           * not serialise the group id), and it is promoted for BOTH source
           * layers so a story keeps one identity across §2.4's overlap.
           */
          promoteId: {
            [STORIES_SOURCE_LAYER]: "url",
            [COUNTRY_SOURCE_LAYER]: "url",
          },
        });

        // §2.2's outline archive is static and committed, so it is addressed
        // relative to the origin rather than through the manifest.
        map.addSource(BOUNDARIES_SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${new URL(BOUNDARIES_ARCHIVE, window.location.href).href}`,
        });

        /**
         * The spider overlay: legs and leaves, computed on the client from what
         * is rendered. It cannot come from the archive — a leaf's position is a
         * pixel offset from its anchor, so it depends on the current camera.
         */
        map.addSource(SPIDER_SOURCE_ID, { type: "geojson", data: EMPTY_SPIDER });

        /**
         * The selection triangle: at most one feature, empty until something is
         * clicked. Its image is generated rather than loaded — see `lib/pin.ts`
         * for why this repo has no sprite.
         */
        map.addSource(SELECTED_SOURCE_ID, { type: "geojson", data: NO_PIN });
        map.addImage(PIN_IMAGE_ID, trianglePin(), { pixelRatio: PIN_PIXEL_RATIO });

        setRegionsUrl(manifest.regionsUrl ?? null);

        // Outlines go under the stories, which go under the labels. Order is
        // asserted in layers.test.ts. The hit targets paint nothing, and go
        // under everything (§2.3 step 2).
        for (const layer of hitLayers()) map.addLayer(layer);
        for (const layer of boundaryLayers()) map.addLayer(layer);

        /**
         * The pins go on top; the headlines go **below the basemap's place
         * labels**, so a country or state name always wins the symbol collision
         * against a headline and stays clickable for §2.3. Measured: appending
         * the headline layer deleted two thirds of the state labels over the US
         * at z5 — see `firstPlaceLabelLayerId`.
         */
        const [countryPins, storyPins, headlines] = storyLayers();
        // The legs go UNDER the pins — a leg is a pointer, and one drawn across
        // a neighbouring story's pin would hide data behind decoration. The
        // leaves go over them, because a leaf IS data and it must win the click.
        const [spiderLegs, spiderLeaves] = spiderLayers();
        map.addLayer(spiderLegs);
        map.addLayer(countryPins);
        map.addLayer(storyPins);
        map.addLayer(spiderLeaves);
        // The five best stories, drawn again above every other disc. See
        // `topPinLayer` — draw order inside a circle layer is tile order, and
        // the highlight is feature state, which a `circle-sort-key` cannot read.
        map.addLayer(topPinLayer());
        // Above every disc, including the top-5 copy: the triangle marks the one
        // thing the reader picked, so nothing may be drawn over it.
        map.addLayer(selectedPinLayer());
        map.addLayer(headlines, firstPlaceLabelLayerId(map.getStyle().layers));

        /* ------------------------------------------------------------------ */
        /* The top-5-on-screen highlight                                       */
        /* ------------------------------------------------------------------ */

        /**
         * The keys currently carrying the flag. Held here rather than read back
         * off the map because `removeFeatureState` needs to know what to clear,
         * and MapLibre offers no way to enumerate the states it holds.
         */
        let marked: string[] = [];

        /**
         * Those of `marked` that are actually flagged on the vector source —
         * every one that a spider has NOT displaced. A displaced story is drawn
         * twice: covered at its anchor, and again as a leaf. Flagging it would
         * scale the covered copy by `TOP_SCALE` and push it out from behind the
         * pin on top of it, which is the overlap this split exists to remove.
         * Its highlight travels on the leaf instead, as a property.
         */
        let flagged: string[] = [];
        let displaced = new Set<string>();

        const setTop = (key: string, top: boolean) => {
          // Both source layers, so the highlight survives the z4 handover from
          // the country floor to the stories layer without a repaint gap.
          for (const sourceLayer of [STORIES_SOURCE_LAYER, COUNTRY_SOURCE_LAYER]) {
            const feature = { source: SOURCE_ID, sourceLayer, id: key };
            if (top) map.setFeatureState(feature, { [TOP_STATE_KEY]: true });
            else map.removeFeatureState(feature, TOP_STATE_KEY);
          }
        };

        /**
         * **On `idle`, not on `moveend`.** "Top 5 on screen" is a question about
         * what is *rendered*, and a move ends before the tiles it uncovered have
         * loaded — ranking there would score the new viewport against the old
         * viewport's features and then never correct itself. `idle` fires once
         * the map has finished loading and drawing everything, which is the
         * first moment the query can answer truthfully.
         *
         * Writing feature state repaints, which produces another `idle`; the
         * `sameKeys` guard is what stops that from being a loop.
         */
        const applyTop = () => {
          const visible = marked.filter((key) => !displaced.has(key));
          if (sameKeys(visible, flagged)) return;

          for (const key of flagged) if (!visible.includes(key)) setTop(key, false);
          for (const key of visible) setTop(key, true);
          flagged = visible;
          // Mode 1: a bubbled headline replaces the 11px one under the pin. Keyed
          // on the bubbles themselves rather than on `marked`, because the two
          // part company the moment the ring re-ranks and the bubbles do not —
          // and because `dismissBubbles` empties this list, which is what gives
          // the five their small labels back.
          map.setFilter(LABELS_LAYER_ID, bubbleLabelFilter(bubbles.map((bubble) => bubble.story.url)));
          // The layer that draws them above every other disc. Its filter and the
          // feature state are set together, always, so the copy on top can never
          // be painted as an ordinary pin or an ordinary pin painted as a copy.
          map.setFilter(TOP_LAYER_ID, topFilter(visible));
        };

        /* ------------------------------------------------------------------ */
        /* Spiderfy                                                            */
        /* ------------------------------------------------------------------ */

        /**
         * The stacks found at the last `idle`. Membership changes only when the
         * rendered features change; POSITIONS change on every camera move,
         * because a leaf is a pixel offset. Keeping the two apart is what lets
         * the expensive half run on idle and the cheap half run on every frame.
         */
        let stacks: Stack[] = [];

        /**
         * The records `StoryBubbles` is rendering, held here as well as in React
         * state because `applyTop` reads them to decide which small labels to
         * suppress, and it runs on every idle rather than on a render.
         */
        let bubbles: TopStory[] = [];

        /** Has the opening ranking been taken? It is taken once; see `refresh`. */
        let bubblesCaptured = false;

        /**
         * Take the bubbles down, permanently, on the reader's first camera move.
         *
         * **`movestart`, and any move counts** — a drag, a wheel, a keyboard
         * nudge, or a `flyTo` from the search bar. The five headlines answer
         * "what is happening in the world" for the view the reader was handed;
         * the instant they choose a different view, that sentence is about
         * somewhere they are no longer looking, and the ring is already there to
         * mark what matters where they went.
         *
         * Armed only once the capture has happened, so a camera animation during
         * startup cannot dismiss bubbles that were never drawn.
         */
        const dismissBubbles = () => {
          if (!bubblesCaptured || !bubbles.length) return;
          bubbles = [];
          setTops(bubbles);
          // Directly rather than through `applyTop`: its `sameKeys` guard returns
          // early whenever the ranking has not changed, and the five have to get
          // their 11px labels back on this move whether or not it re-ranks.
          map.setFilter(LABELS_LAYER_ID, bubbleLabelFilter([]));
          map.off("movestart", dismissBubbles);
        };

        map.on("movestart", dismissBubbles);

        const drawSpider = () => {
          const source = map.getSource<GeoJSONSource>(SPIDER_SOURCE_ID);
          if (!source) return;
          // Below the threshold the budget guarantees one story per coordinate,
          // so there is nothing to spread and the overlay must be empty rather
          // than stale.
          const data =
            map.getZoom() < SPIDERFY_ZOOM || !stacks.length
              ? EMPTY_SPIDER
              : spiderData(stacks, map, marked, selectedUrl.current);
          source.setData(data);
        };

        // The selection's own trigger: a click recolours a leaf, and a click
        // moves no camera, so nothing else here would rebuild the overlay.
        redrawSpider.current = drawSpider;

        /**
         * **On `idle`, not on `moveend`.** Both halves of this ask what is
         * *rendered*, and a move ends before the tiles it uncovered have loaded —
         * ranking or grouping there scores the new viewport against the old
         * viewport's features and never corrects itself. `idle` fires once the
         * map has finished loading and drawing, which is the first moment the
         * query can answer truthfully.
         *
         * Writing feature state or overlay data repaints, which produces another
         * `idle`; the `sameKeys` and `sameStacks` guards are what stop that from
         * being a loop.
         */
        const refresh = () => {
          const layers = [STORIES_LAYER_ID, COUNTRY_LAYER_ID].filter((id) => map.getLayer(id));
          if (!layers.length) return;
          // The pin layers only — never the leaves. A leaf is a copy of a story
          // that is already in this list, and feeding the overlay back into its
          // own input is how a spider grows a spider.
          const features = map.queryRenderedFeatures({ layers });

          marked = topKeys(features);

          /**
           * Mode 1's bubbles, from the same query and the same ranking — the
           * headline and the coordinate for each of `marked`, best first.
           *
           * **Taken once, at the first idle, and never recomputed.** That idle is
           * the default world view, so these five are the top five stories in the
           * world rather than the top five of whatever the reader is looking at;
           * `dismissBubbles` retires them on the first camera move. The ring,
           * which keeps recomputing below, is the part of this that stays live.
           *
           * Deduplicated by url on the way in, because `renderWorldCopies` draws
           * a story once per visible copy of the world and §2.4 draws it again
           * in the country floor. Which copy wins does not matter:
           * `StoryBubbles` normalises the longitude to the copy nearest the
           * camera before it projects.
           */
          if (!bubblesCaptured) {
            const found = new Map<string, TopStory>();
            for (const feature of features) {
              if (feature.geometry.type !== "Point") continue;
              const selected = panelStory(feature.properties);
              if (!selected || found.has(selected.url)) continue;
              found.set(selected.url, {
                story: selected,
                lngLat: feature.geometry.coordinates as [number, number],
              });
            }

            const opening = marked
              .map((key) => found.get(key))
              .filter((bubble): bubble is TopStory => Boolean(bubble));

            // An idle that ranked nothing is not the opening view — the style has
            // loaded but this archive's first tiles have not. Leave the capture
            // open rather than freezing an empty set for the whole session.
            if (opening.length) {
              bubbles = opening;
              bubblesCaptured = true;
              setTops(bubbles);
            }
          }

          // The stacks are read BEFORE the highlight is applied: which stories a
          // spider has displaced decides which of the five may be flagged on the
          // vector source at all.
          const found = map.getZoom() < SPIDERFY_ZOOM ? [] : stacksFrom(features);
          if (!sameStacks(found, stacks)) {
            stacks = found;
            displaced = displacedUrls(found);
          }

          applyTop();
          // Membership may be unchanged while the top-5 flags on the leaves are
          // not, and those live in the overlay's data rather than in state.
          drawSpider();
        };

        map.on("idle", refresh);
        /**
         * **`zoom`, not `move`.** A leaf's position is its anchor plus a pixel
         * offset, and under a pan the anchor and the leaf translate together —
         * the geography does not need recomputing and the spider is already
         * correct. Only a zoom changes what a pixel is worth. Rebuilding on
         * `move` instead would hand the source worker a fresh FeatureCollection
         * on every frame of every drag, to redraw the identical picture.
         */
        map.on("zoom", drawSpider);

        /** §2.2: one outline at a time, and none by default. */
        const clearOutline = () => {
          for (const id of [COUNTRY_OUTLINE_ID, REGION_OUTLINE_ID]) {
            map.setFilter(id, MATCH_NOTHING);
          }
        };

        /**
         * §2.3's label gesture: a click that hit no pin may still have hit a
         * country or state label.
         *
         * **The label gives the level; our own polygons give the id.** State
         * labels carry no region code on either provider, and joining
         * "California" to `USCA` by name is §3.4's join trap wearing a new hat
         * (§2.3). So the id comes from hit-testing `boundaries.pmtiles`, which
         * makes it by construction an id the outline archive can draw.
         *
         * The camera does not move. That is the deliberate change from the
         * original §2.3 — the panel surfaces the region's stories directly, so
         * the zoom stopped being the mechanism and became a move the user did
         * not ask for.
         */
        const selectRegionAt = (event: MapMouseEvent) => {
          const label = firstLabel(map.queryRenderedFeatures(event.point));
          if (!label) return;

          const hitLayer = HIT_LAYER_FOR[label.level];
          if (!map.getLayer(hitLayer)) return;

          /**
           * The LABEL's anchor, not the click point: a country's name is drawn
           * near its centroid, while the click that selected it can land
           * several pixels outside the coastline — over water, or over a
           * neighbour — and the join would then be off by one country.
           *
           * The click point is the fallback for the one case the anchor cannot
           * serve: with `renderWorldCopies` on, a label in a repeated copy of
           * the world projects to a pixel that may be off-screen, where nothing
           * is rendered to query.
           */
          const anchor = labelAnchor(label.feature);
          const points = anchor ? [map.project(anchor), event.point] : [event.point];

          for (const point of points) {
            const [polygon] = map.queryRenderedFeatures(point, { layers: [hitLayer] });
            const id = polygon?.properties?.id;
            if (typeof id !== "string" || !id) continue;

            map.setFilter(OUTLINE_LAYER_FOR[label.level], matchId(id));
            // On the label's own anchor where there is one, so the triangle
            // lands on the name the reader clicked rather than on the pixel
            // they happened to hit. A region has no orange circle of its own,
            // so here the triangle is the whole mark.
            showPin(map, anchor ?? [event.lngLat.lng, event.lngLat.lat]);
            setSelection({ id, name: labelName(label.feature) });
            return;
          }

          // No polygon under the label: Natural Earth and the basemap disagree
          // about what exists there. Draw nothing rather than guess — `IN25`
          // has no outline for the same reason (§4).
        };

        /**
         * **One handler for the whole map, not one per layer.**
         *
         * The per-layer form registers the same handler twice over two layers
         * that overlap by design (§2.4), so a click where both match runs it
         * twice: two popups, and two competing writes to the outline filter.
         * Hit-testing once gives a single deterministic answer, in the layer
         * priority order `CLICKABLE_LAYER_IDS` states.
         *
         * It also gives the map a dismiss: clicking empty ocean closes the panel
         * and clears the outline, which §2.2's "click-reveal only" implies.
         *
         * Note that the top-most feature wins, and at world zoom that is often a
         * PIN sitting over a container — clicking "Texas" where a Bell County
         * pin overlaps it selects the pin, and correctly draws no outline.
         */
        map.on("click", (event: MapMouseEvent) => {
          const layers = CLICKABLE_LAYER_IDS.filter((id) => map.getLayer(id));
          const [feature] = map.queryRenderedFeatures(event.point, { layers });

          setStory(null);
          clearRegion();
          clearOutline();

          // A pin is hit-tested FIRST and wins the tap, even where it sits over
          // a country label. The pin is the smaller, more deliberate target.
          if (!feature) {
            selectRegionAt(event);
            return;
          }

          const selected = panelStory(feature.properties);
          if (!selected) return;

          // §2.2: "Clicking any container story outlines its container in red."
          // A PIN gets none — it is at an exact place, and drawing a region
          // around it would claim the opposite.
          // Dead while containers are filtered off the map (`NOT_CONTAINER`) —
          // no click can produce a feature this accepts. Kept wired because the
          // "somewhere in" stories are moving into the region panel and will
          // need the same join to draw their outline from there.
          const outline = outlineFor(feature.properties);
          if (outline) {
            map.setFilter(outline.layerId, ["==", ["get", "id"], outline.id]);
          }

          /**
           * The triangle goes on the FEATURE's coordinate, not the click point,
           * so its tip meets the centre of the circle the reader aimed at. On a
           * spider leaf that is the displaced position — which is correct: the
           * leaf is where the story is drawn, and the tip has to agree with what
           * is on screen rather than with where the story really is.
           */
          selectStory(
            selected,
            feature.geometry.type === "Point"
              ? (feature.geometry.coordinates as [number, number])
              : [event.lngLat.lng, event.lngLat.lat],
          );
        });

        for (const layer of CLICKABLE_LAYER_IDS) {
          map.on("mouseenter", layer, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layer, () => {
            map.getCanvas().style.cursor = "";
          });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // §7 critical gap 3. A manifest that will not load is the one failure
        // where the map is otherwise healthy — basemap, controls, no map error
        // event — so nothing else would ever say why the world is empty.
        setError(
          `Story data unavailable — could not read the manifest. (${
            cause instanceof Error ? cause.message : String(cause)
          })`,
        );
      });

    // A tile or archive that fails after the source is added: the manifest was
    // fine, the thing it points at is not.
    map.on("error", (event: ErrorEvent) => {
      const message = event.error?.message ?? "unknown map error";
      if (/pmtiles|stories/i.test(message)) {
        setError(`Story tiles unavailable — the published archive did not load. (${message})`);
      }
    });

    return () => {
      cancelled = true;
      setReady(null);
      // The handler closes over a map that is about to be removed.
      redrawSpider.current = null;
      map.remove();
      removeProtocol("pmtiles");
    };
  }, []);

  /**
   * `unavailable` is one state for two causes on purpose: a manifest with no
   * `regionsUrl` (published before the index existed) and an index that would
   * not load are the same thing from the reader's side — no list, working map.
   */
  const panelStatus = !regionsUrl || indexFailed ? "unavailable" : index ? "ready" : "loading";

  return (
    <>
      <div ref={container} className="map" />

      {/*
        Mode 1: the top five headlines, in bubbles pointing at their own pins.
        Outside the map container rather than inside it, so MapLibre never sees
        the nodes — it owns its container's children, and a React subtree in
        there is a subtree two libraries both believe they are managing.
      */}
      <StoryBubbles
        map={ready}
        stories={tops}
        selectedUrl={story?.url ?? null}
        onSelect={(selected, at) => selectStory(selected, at)}
      />

      {/*
        The story panel and the region panel share one slot, and the click
        handler guarantees at most one selection at a time — a story click clears
        the region and a region click can only happen where no story was hit.
        The story is rendered first so that guarantee is visible here too.
      */}
      {story && <StoryPanel story={story} onClose={clearStory} />}

      {!story && selection && (
        <RegionPanel
          name={selection.name}
          regionId={selection.id}
          entry={entryFor(index, selection.id)}
          status={panelStatus}
          /* `null` hides the button — see `zoomToRegion` and `bboxFor`. */
          onZoom={bboxFor(bboxes, selection.id) ? zoomToRegion : null}
          onClose={clearRegion}
        />
      )}
      {/*
        §2.6's logo, bottom-left of the MAP, and as of 2026-08-16 it is the ONLY
        copy: both cards end ~200px above this corner, so the mark is visible past
        either of them. Mode 2's card carries "How does this work?" in its footer
        instead, and Mode 3's region card has no footer at all — see
        `MapTilerLogo` for what the second copy was for.

        **This rule was commented out in globals.css and restored on 2026-08-16.**
        Without it the anchor fell into normal flow at the top of `main`, which is
        exactly the silent §2.6 failure the two-copy arrangement was built to
        prevent. Do not disable it again without saying where the mark went.
      */}
      <MapTilerLogo />
      {provider === "openfreemap" && (
        <div className="notice notice--info">
          Keyless basemap (OpenFreeMap escape hatch). Set{" "}
          <code>NEXT_PUBLIC_MAPTILER_KEY</code> for the MapTiler style.
        </div>
      )}
      {error && <div className="notice notice--error">{error}</div>}
    </>
  );
}
