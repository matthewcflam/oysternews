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
  MATCH_NOTHING,
  OUTLINE_LAYER_FOR,
  REGION_OUTLINE_ID,
  SOURCE_ID,
  SPIDER_SOURCE_ID,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
  TOP_LAYER_ID,
  TOP_STATE_KEY,
  boundaryLayers,
  firstPlaceLabelLayerId,
  hitLayers,
  matchId,
  outlineFor,
  spiderLayers,
  storyLayers,
  topFilter,
  topPinLayer,
} from "@/lib/layers";
import { loadManifest } from "@/lib/manifest";
import { nearbyBox, nearbyStories } from "@/lib/nearby";
import { loadRegionIndex, storiesFor } from "@/lib/regions";
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

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = basemap().provider;

  /**
   * The selected story and its neighbours.
   *
   * **This is what the map popup used to be.** A click no longer anchors a box to
   * the dot it hit; it opens the left panel, which is the same slot §2.3's region
   * panel uses. Holding the selection in React state rather than in a MapLibre
   * `Popup` is what lets the panel be a component with a testable content model
   * (`lib/story.ts`) instead of an HTML string.
   *
   * `nearby` is captured at click time, not recomputed as the camera moves. The
   * list answers "what was around the story when you opened it", and a list that
   * reshuffled under a pan would be a moving target in a panel the reader is
   * reading.
   */
  const [story, setStory] = useState<PanelStory | null>(null);
  const [nearby, setNearby] = useState<PanelStory[]>([]);

  /**
   * The panel, slid off the left edge but still selected.
   *
   * **Held here rather than inside the panels**, because `StoryPanel` and
   * `RegionPanel` are two components sharing one slot: state owned by either of
   * them would reset the moment the reader went from a pin to a country label,
   * and the tab would spring back open for no reason the reader could name.
   *
   * It is deliberately NOT the same thing as "no selection". Collapsed keeps the
   * story, the outline and the top-5 highlight exactly as they were and only
   * moves the column out of the way; closing throws all of that away. The tab and
   * the × are different controls because they answer different questions — "let
   * me see the map" and "I'm done with this story".
   */
  const [collapsed, setCollapsed] = useState(false);

  /**
   * §2.3's region panel. `regionsUrl` is optional on the manifest — one
   * published before 2026-08-13 has none — so `null` here means the panel is
   * unavailable, not broken, and the map must go on working without it.
   */
  const [regionsUrl, setRegionsUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [index, setIndex] = useState<RegionIndex | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);

  /** Clear the outline from outside the map effect — the panel's close button. */
  const clearRegion = () => {
    setSelection(null);
    for (const id of [COUNTRY_OUTLINE_ID, REGION_OUTLINE_ID]) {
      if (mapRef.current?.getLayer(id)) mapRef.current.setFilter(id, MATCH_NOTHING);
    }
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
    setNearby([]);
    clearRegion();
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

        const drawSpider = () => {
          const source = map.getSource<GeoJSONSource>(SPIDER_SOURCE_ID);
          if (!source) return;
          // Below the threshold the budget guarantees one story per coordinate,
          // so there is nothing to spread and the overlay must be empty rather
          // than stale.
          const data =
            map.getZoom() < SPIDERFY_ZOOM || !stacks.length
              ? EMPTY_SPIDER
              : spiderData(stacks, map, marked);
          source.setData(data);
        };

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

          /**
           * **Every click starts from a clean slate**, which settles the one
           * question §2.3 left open: a container click clears a region lock.
           * There is one red outline and one panel, and a container outline
           * drawn while a region outline is still up would leave the user
           * unable to say which of the two the map is claiming is selected.
           */
          setStory(null);
          setNearby([]);
          clearRegion();
          clearOutline();
          /**
           * A click always re-opens the panel. Leaving it collapsed would make
           * the click produce NO visible response at all — the panel is off
           * screen, so a new story would swap in where nobody can see it, and
           * the map would look broken rather than busy.
           */
          setCollapsed(false);

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
          const outline = outlineFor(feature.properties);
          if (outline) {
            map.setFilter(outline.layerId, ["==", ["get", "id"], outline.id]);
          }

          /**
           * "Stories Nearby": a second query over the same layers, this time
           * across a box rather than a point. Run here, once per click, rather
           * than on `idle` with everything else — the neighbours of a story are
           * a property of the click, not of the viewport, and recomputing them
           * on every camera settle would rewrite a list the reader is reading.
           */
          const around = map.queryRenderedFeatures(nearbyBox(event.point), { layers });

          // §2.6 (link-out only) and §5.2 decision 3 (the pin half of the
          // geotag-confidence treatment) both live in `lib/story.ts`, where they
          // are tested rather than reviewed.
          setStory(selected);
          setNearby(nearbyStories(around, selected.url));
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
        The story panel and the region panel share one slot, and the click
        handler guarantees at most one selection at a time — a story click clears
        the region and a region click can only happen where no story was hit.
        The story is rendered first so that guarantee is visible here too.
      */}
      {story && (
        <StoryPanel
          story={story}
          nearby={nearby}
          /*
            Selecting a neighbour swaps the panel without going back to the map.
            The list itself is left alone: every story in it is near every other,
            so re-querying would produce the same neighbourhood minus one, and
            would cost the reader the list they were part-way through.
          */
          onSelect={(next) => {
            setStory(next);
            setNearby([story, ...nearby].filter((other) => other.url !== next.url));
          }}
          onClose={clearStory}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((open) => !open)}
        />
      )}

      {!story && selection && (
        <RegionPanel
          name={selection.name}
          regionId={selection.id}
          stories={storiesFor(index, selection.id)}
          status={panelStatus}
          onClose={clearRegion}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((open) => !open)}
        />
      )}
      {/*
        §2.6's logo, bottom-left of the MAP. The story panel is full-bleed and
        covers this corner, so it renders a second copy of the same component in
        its own footer — see `MapTilerLogo`. This one no longer sits above the
        panel (its z-index dropped from 4 to 2 on 2026-08-14); the panel's copy
        is what keeps the requirement met while a story is open.
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
