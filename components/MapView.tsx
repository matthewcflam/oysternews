"use client";

import { useEffect, useRef, useState } from "react";
import {
  MapLibreMap,
  NavigationControl,
  Popup,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
  type ErrorEvent,
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
  COUNTRY_OUTLINE_ID,
  HIT_LAYER_FOR,
  MATCH_NOTHING,
  OUTLINE_LAYER_FOR,
  REGION_OUTLINE_ID,
  SOURCE_ID,
  boundaryLayers,
  firstPlaceLabelLayerId,
  hitLayers,
  matchId,
  outlineFor,
  storyLayers,
} from "@/lib/layers";
import { loadManifest } from "@/lib/manifest";
import { storyPopupHtml } from "@/lib/popup";
import { loadRegionIndex, storiesFor } from "@/lib/regions";
import type { RegionIndex } from "@/lib/types";
import RegionPanel from "./RegionPanel";

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
  /**
   * The story popup, held outside the map effect so the Global button can close
   * it. There is only ever one — the single click handler below guarantees it.
   */
  const popupRef = useRef<Popup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = basemap().provider;

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
   * §2.3's Global button — the only camera move in the feature, and therefore
   * the only place `prefers-reduced-motion` applies (§2.6).
   *
   * **Checked at call time, not at mount.** The OS setting can change while the
   * page is open, and a value read once at mount would honour a preference the
   * user has since turned off — or, worse, animate for someone who turned it on.
   */
  const resetCamera = () => {
    // §2.3's table: Global is Default's camera with no outline and no panel.
    // Leaving a story popup open would land the user in a state the table does
    // not describe — a selected story with nothing selected on the map.
    popupRef.current?.remove();
    popupRef.current = null;
    clearRegion();
    const camera = { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) mapRef.current?.jumpTo(camera);
    else mapRef.current?.flyTo({ ...camera, speed: 0.8 });
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

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
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
        });

        // §2.2's outline archive is static and committed, so it is addressed
        // relative to the origin rather than through the manifest.
        map.addSource(BOUNDARIES_SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${new URL(BOUNDARIES_ARCHIVE, window.location.href).href}`,
        });

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
        map.addLayer(countryPins);
        map.addLayer(storyPins);
        map.addLayer(headlines, firstPlaceLabelLayerId(map.getStyle().layers));

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
         * It also gives the map a dismiss: clicking empty ocean closes the popup
         * and clears the outline, which §2.2's "click-reveal only" implies.
         *
         * Note that the top-most feature wins, and at world zoom that is often a
         * PIN sitting over a container — clicking "Texas" where a Bell County
         * pin overlaps it selects the pin, and correctly draws no outline.
         */
        map.on("click", (event: MapMouseEvent) => {
          const [feature] = map.queryRenderedFeatures(event.point, {
            layers: CLICKABLE_LAYER_IDS.filter((id) => map.getLayer(id)),
          });

          popupRef.current?.remove();
          popupRef.current = null;
          /**
           * **Every click starts from a clean slate**, which settles the one
           * question §2.3 left open: a container click clears a region lock.
           * There is one red outline and one panel, and a container outline
           * drawn while a region outline is still up would leave the user
           * unable to say which of the two the map is claiming is selected.
           */
          clearRegion();
          clearOutline();

          // A pin is hit-tested FIRST and wins the tap, even where it sits over
          // a country label. The pin is the smaller, more deliberate target.
          if (!feature) {
            selectRegionAt(event);
            return;
          }

          // §2.2: "Clicking any container story outlines its container in red."
          // A PIN gets none — it is at an exact place, and drawing a region
          // around it would claim the opposite.
          const outline = outlineFor(feature.properties);
          if (outline) {
            map.setFilter(outline.layerId, ["==", ["get", "id"], outline.id]);
          }

          // §2.6 (link-out only) and §5.2 decision 3 (the pin half of the
          // geotag-confidence treatment) both live in `lib/popup.ts`, where they
          // are tested rather than reviewed.
          const popup = new Popup({ closeButton: true, maxWidth: "280px" })
            .setLngLat(event.lngLat)
            .setHTML(storyPopupHtml(feature.properties));
          // MapLibre 6's `on` returns a Subscription rather than the emitter, so
          // this cannot be chained onto the builder above.
          popup.on("close", clearOutline);
          popup.addTo(map);
          popupRef.current = popup;
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
        §2.3's Global button: a preset of Default, not a structural state. It
        returns the camera to whole-planet zoom and closes the panel, and it is
        the only camera move in the feature.
      */}
      <button type="button" className="global-button" onClick={resetCamera}>
        Global
      </button>

      {selection && (
        <RegionPanel
          name={selection.name}
          regionId={selection.id}
          stories={storiesFor(index, selection.id)}
          status={panelStatus}
          onClose={clearRegion}
        />
      )}
      {/*
        §2.6: "MapTiler attribution and logo stay visible." MapTiler's Free plan
        requires the logo, not just the text credit, and MapLibre's
        AttributionControl only renders text — the MapTiler SDK is what would
        normally add this. Rendered only for the MapTiler provider: showing their
        logo over an OpenFreeMap basemap would credit the wrong source.
      */}
      {provider === "maptiler" && (
        <a
          className="maptiler-logo"
          href="https://www.maptiler.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://api.maptiler.com/resources/logo.svg"
            alt="MapTiler"
            width={110}
            height={30}
          />
        </a>
      )}
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
