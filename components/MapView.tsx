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
import { CITY_SNAP_KM, loadCityShard, nearestCity } from "@/lib/cities";
import { CONTINENT_BBOX, continentIdFor } from "@/lib/continents";
import { countryName, fipsForIso } from "@/lib/flag";
import { firstLabel, labelAnchor, labelName, type LabelLevel } from "@/lib/labels";
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
import type { PlaceEntry } from "@/lib/place-search";
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
import type { CityShard, RegionIndex } from "@/lib/types";
import MapTilerLogo from "./MapTilerLogo";
import RegionPanel from "./RegionPanel";
import SearchBar from "./SearchBar";
import StoryBubbles, { type TopStory } from "./StoryBubbles";
import StoryPanel from "./StoryPanel";

/**
 * The map. This component owns wiring only — source, camera, click
 * behaviour. How the layers look lives in `lib/layers.ts`, since those
 * specs encode product rules worth testing rather than reviewing. The
 * archive is whatever manifest.json currently points at, which changes
 * every run, hence the async step before a source can be added. MapLibre 6
 * has no default export and aliases its Map class to avoid shadowing the
 * global `Map`, hence the named `MapLibreMap` import.
 */

/**
 * MapLibre 6 builds its worker from a Blob that does `import "<runtime url>"`,
 * which Turbopack cannot resolve. Left alone the worker silently 404s and the map
 * paints the basemap background but never loads a source or requests a tile — no
 * error event, no console warning. Pointing at the copy that `predev`/`prebuild`
 * place in public/ (scripts/copy-maplibre-worker.mjs) is the supported fix.
 */
const WORKER_URL = "/maplibre-gl-worker.mjs";

/**
 * What a label click resolved to. `country`/`state` carry an id the
 * outline archive can draw. `continent` carries a `CONT:XX` id into the
 * same region index and draws no outline. `city` carries no id of its own
 * — only the country FIPS its shard is keyed by and the label's own
 * anchor, which `nearestCity` snaps to a published record.
 */
type Selection =
  | { kind: "country" | "state"; id: string; name: string }
  | { kind: "continent"; id: string; name: string }
  | { kind: "city"; country: string; name: string; at: [number, number] };

const NO_PIN: FeatureCollection = { type: "FeatureCollection", features: [] };

// The "World" button's own fixed height and its gap from MapLibre's zoom
// control — both are CSS facts (see .reset-view-btn) needed here too since
// the position effect computes the button's offset from the control's box.
const WORLD_BTN_HEIGHT = 29;
const WORLD_BTN_GAP = 6;

// The city record a selection resolves to, or null (still loading, the
// shard has nothing this country, or nothing is within CITY_SNAP_KM).
// Pure and outside the component so zoomToRegion and the panel's render
// can both call it without duplicating the match.
function cityRecordFor(
  selection: Selection | null,
  cityShard: { country: string; shard: CityShard } | null,
) {
  if (!selection || selection.kind !== "city") return null;
  if (cityShard?.country !== selection.country) return null;
  return nearestCity(cityShard.shard, selection.at, CITY_SNAP_KM);
}

// Drop the selection triangle at a coordinate, or clear it with null. A
// one-feature GeoJSON source rather than a Marker: a marker is a DOM node
// positioned per drag frame and would lag the pin under it by a frame,
// visible at the triangle's tip as sliding off its own dot.
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
  // The same map as mapRef, in state, purely so the overlay re-renders
  // once it exists — a ref is invisible to React.
  const [ready, setReady] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = basemap().provider;

  // Where MapLibre's own zoom control actually sits, in `right`/`bottom`
  // CSS px for the "World" button below to match. Measured rather than a
  // fixed offset: the attribution control is stacked in the same
  // bottom-right corner underneath it, and attribution text can wrap to a
  // second line at a narrow viewport, which pushes the zoom control up by
  // a variable amount. A ResizeObserver on the control keeps this correct
  // through that and through the container itself resizing.
  const [worldBtnPos, setWorldBtnPos] = useState<{ right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const group = ready
      .getContainer()
      .querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right .maplibregl-ctrl-group");
    if (!group) return;

    const measure = () => {
      const containerRect = ready.getContainer().getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      setWorldBtnPos({
        right: containerRect.right - groupRect.left + WORLD_BTN_GAP,
        bottom: containerRect.bottom - (groupRect.top + groupRect.height / 2) - WORLD_BTN_HEIGHT / 2,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ready]);

  // The selected story. A click opens this panel rather than anchoring a
  // MapLibre Popup, which is what lets the panel be a component with a
  // testable content model (lib/story.ts) instead of an HTML string.
  const [story, setStory] = useState<PanelStory | null>(null);

  // The open story's url, and the spider's redraw, both held for
  // markSelected. Refs, not state: both readers (feature state on the
  // vector source, the leaf property on the overlay) are written from map
  // code outside React's render ordering — reading off state would paint
  // the disc a render late.
  const selectedUrl = useRef<string | null>(null);
  const redrawSpider = useRef<(() => void) | null>(null);

  // Fly back to the opening view and restore the orange headline bubbles —
  // wired up inside the map effect, where the bubble capture and dismissal
  // machinery already lives. Exposed as a ref so the "world" button below
  // can call it without duplicating that state.
  const resetHome = useRef<(() => void) | null>(null);

  // The opening-card speech bubbles: the five stories the ring marks on
  // arrival. Written exactly twice — once at the first idle (top five of
  // the default world view), once back to empty on the first camera move.
  // See dismissBubbles and docs/DESIGN.md#the-selection-triangle-and-the-opening-card-bubbles.
  const [tops, setTops] = useState<TopStory[]>([]);

  // There are three ways to close a panel: Escape below, a click on the
  // map background (the miss path in the click handler), and the panel's
  // own close button.

  // The region panel. regionsUrl is optional on the manifest — a manifest
  // published before the index existed has none — so null here means
  // "unavailable," not broken.
  const [regionsUrl, setRegionsUrl] = useState<string | null>(null);
  /** Absent/1 means the region index predates `CONT:*` keys — a continent click must read `unavailable`, not an honestly-empty fetch result. */
  const [regionsVersion, setRegionsVersion] = useState<number>(1);
  /** URL prefix of the per-country city shards. `null` for a manifest published before city shards existed — same optionality as `regionsUrl`. */
  const [citiesBase, setCitiesBase] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [index, setIndex] = useState<RegionIndex | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);
  // The city shard, kept alongside the country it was fetched for so a
  // shard still in flight for a NEW selection is never read as its answer
  // — two fast clicks in different countries must not show one country's
  // cities under the other's heading for a frame.
  const [cityShard, setCityShard] = useState<{ country: string; shard: CityShard } | null>(null);
  const [cityShardFailed, setCityShardFailed] = useState(false);

  // The "Zoom to Texas" table. Committed and static, so it has no
  // `unavailable` state of its own — a failed fetch just leaves this null
  // and the panel doesn't draw the button.
  const [bboxes, setBboxes] = useState<BboxTable | null>(null);

  // Move the MARK fill onto one story's disc, or take it off with null.
  // Both source layers, so the flag survives the z4 handover between the
  // country floor and the stories layer without a repaint gap. Redraws
  // the spider last, since a leaf carries the flag as data, not state.
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

  // Clear the outline and selection pin from outside the map effect — the
  // panel's close button. The triangle is torn down alongside the
  // outline since the two are the same statement ("this is what you
  // picked"); clearing one without the other leaves the map pointing at
  // something the panel no longer shows.
  const clearRegion = () => {
    setSelection(null);
    markSelected(null);
    showPin(mapRef.current, null);
    for (const id of [COUNTRY_OUTLINE_ID, REGION_OUTLINE_ID]) {
      if (mapRef.current?.getLayer(id)) mapRef.current.setFilter(id, MATCH_NOTHING);
    }
  };

 const BBOX_OVERRIDES: Record<string, [number, number, number, number]> = {
  FR: [-5.14, 41.33, 9.56, 51.10],    // Metropolitan France
  US: [-137.0, 24.39, -66.93, 49.38],  // Contiguous USA (Lower 48)
  NO: [4.5, 57.9, 31.1, 71.2],
  NL: [3.3, 50.7, 7.2, 53.6],
  EC: [-100.0, -5.5, -70.0, 2.5],
};

/** Degrees of padding around a city's coordinate — there is no polygon to fit, only a point. */
const CITY_ZOOM_PAD = 0.12;

// The box zoomToRegion would fit for the current selection, or null —
// which also gates the button's presence below, so the two can never
// disagree about whether "Zoom to" does anything.
const zoomTargetFor = (
  current: Selection | null,
): [number, number, number, number] | null => {
  if (!current) return null;
  switch (current.kind) {
    case "country":
    case "state":
      return BBOX_OVERRIDES[current.id] ?? bboxFor(bboxes, current.id);
    case "continent":
      return CONTINENT_BBOX[current.id as keyof typeof CONTINENT_BBOX] ?? null;
    case "city": {
      const record = cityRecordFor(current, cityShard);
      if (!record) return null;
      return [
        record.lon - CITY_ZOOM_PAD,
        record.lat - CITY_ZOOM_PAD,
        record.lon + CITY_ZOOM_PAD,
        record.lat + CITY_ZOOM_PAD,
      ];
    }
  }
};

// Fly the camera to a box — shared by the region panel's "Zoom to" button
// and a search selection, so the two gestures cannot drift apart on padding
// or the z9 ceiling. fitBounds, not flyTo with a computed zoom: the box is
// the datum, and fitBounds accounts for viewport aspect ratio. MAX_FIT_ZOOM
// keeps a small region from overshooting the archive's z12 ceiling.
const fitTo = (box: [number, number, number, number] | null) => {
  const map = mapRef.current;
  if (!map || !box || box.length < 4) return;

  const [minLng, minLat, maxLng, maxLat] = box;

  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM },
  );
};

const zoomToRegion = () => fitTo(zoomTargetFor(selection));

  // Close the story panel and drop the container outline it drew. Shares
  // clearRegion's outline clearing since only one outline may exist on the
  // map — "no story selected" and "no region selected" mean the same
  // thing about the outline layers.
  const clearStory = () => {
    setStory(null);
    clearRegion();
  };

  // Open a story: the panel, its neighbours, and the triangle on its
  // coordinate. One path for two gestures (pin click and bubble click),
  // so the map can't grow a difference between them over time. `at` is
  // where the triangle goes.
  const selectStory = (selected: PanelStory, at: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;

    // Every selection starts from a clean slate — a container click also
    // clears a region lock, since only one outline and one panel may
    // exist at a time.
    clearRegion();
    showPin(map, at);
    // After clearRegion, which has just taken the fill off whatever was open.
    markSelected(selected.url);

    setStory(selected);
  };

  // A search selection: fly to the box, draw the outline, and open the same
  // panel a label click would. No triangle — see the comment below.
  const selectPlace = async (place: PlaceEntry) => {
    const map = mapRef.current;
    if (!map) return;

    // Every selection starts from a clean slate, same as every other path.
    setStory(null);
    clearRegion();

    const box =
      place.kind === "continent"
        ? (CONTINENT_BBOX[place.id as keyof typeof CONTINENT_BBOX] ?? null)
        : await loadRegionBboxes().then(
            (table) => {
              setBboxes(table);
              return BBOX_OVERRIDES[place.id] ?? bboxFor(table, place.id);
            },
            () => null,
          );

    fitTo(box);

    if (place.kind === "country" || place.kind === "state") {
      const outlineLayer = OUTLINE_LAYER_FOR[place.kind];
      if (outlineLayer) map.setFilter(outlineLayer, matchId(place.id));
    }

    // No selection triangle. The triangle means "this is the exact point you
    // clicked" — a search has no point, and dropping one at a bbox centre
    // would put Indonesia's mark in the Java Sea. The camera move and the
    // red outline are the statement instead.
    setSelection({ kind: place.kind, id: place.id, name: place.name });
  };

  // The index, fetched lazily on first open — nothing needs it until a
  // label is clicked. See docs/DESIGN.md#regions.
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

  // The bbox table, on the same trigger and for the same reason. A
  // separate effect rather than a second `then` inside the index one:
  // they're independent (the index can be unavailable, this cannot), and
  // chaining would make a missing regionsUrl also cost the zoom button.
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

  // The city shard, fetched lazily per country on the first city click in
  // it. Skips the fetch when the cache already holds that country's shard
  // — loadCityShard itself memoizes per URL, so this guard just avoids
  // re-running the effect body on unrelated selection changes.
  useEffect(() => {
    if (!selection || selection.kind !== "city" || !citiesBase) return;
    if (cityShard?.country === selection.country) return;
    let cancelled = false;
    setCityShardFailed(false);

    loadCityShard(citiesBase, selection.country)
      .then((shard) => {
        if (!cancelled) setCityShard({ country: selection.country, shard });
      })
      .catch(() => {
        if (!cancelled) setCityShardFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [selection, citiesBase, cityShard]);

  // Escape closes whichever panel is open — the one dismissal without a
  // mouse. Bound only while something is open, so the map doesn't carry a
  // global keydown listener to do nothing with. `story` wins over
  // `selection` in the same order the render does.
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
      // z2, forced by MapTiler's country labels not existing below it —
      // see lib/basemap.ts. The label click gesture needs one clickable on arrival.
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      renderWorldCopies: true,
      // No 3D: NavigationControl ships with showCompass:false, so a
      // tilted/spun camera would have no control to put it back
      // north-up. Right-drag rotate and pitch are off here; pinch and
      // keyboard rotation are disabled just below (no constructor flag).
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: false },
    });

    // Leaves pinch-zoom and arrow-key panning intact; removes only the rotation
    // component of each.
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    // Bottom-right, not top-right: the freshness stamp took that corner
    // when the masthead was removed, and the two would overlap there.
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    setReady(map);

    // Dev-only test seam: this project has shipped green and rendered
    // nothing, more than once, and the fix each time was a way to ask the
    // running map what it actually did rather than guess pixel
    // coordinates. Stripped from production by the NODE_ENV check, which
    // Next inlines at build time — not in the bundle, not just unreachable.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __sonderMap?: unknown }).__sonderMap = map;
    }

    // Two independent things must finish before a source can be added:
    // the manifest fetch and the map's own load. Awaiting both as
    // promises is correct in both win orders.
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
          // Gives every story feature a stable id, which is what makes
          // setFeatureState (and the top-5 highlight) possible at all —
          // tippecanoe writes no feature ids. `url` is the only property
          // unique per group, promoted for BOTH source layers so a story
          // keeps one identity across the country-floor overlap.
          promoteId: {
            [STORIES_SOURCE_LAYER]: "url",
            [COUNTRY_SOURCE_LAYER]: "url",
          },
        });

        // The outline archive is static and committed, addressed relative
        // to the origin rather than through the manifest.
        map.addSource(BOUNDARIES_SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${new URL(BOUNDARIES_ARCHIVE, window.location.href).href}`,
        });

        // The spider overlay: legs and leaves, computed client-side — a
        // leaf's position is a pixel offset from its anchor, so it can't
        // come from the archive.
        map.addSource(SPIDER_SOURCE_ID, { type: "geojson", data: EMPTY_SPIDER });

        // The selection triangle: at most one feature, empty until
        // clicked. Image is generated, not loaded — see lib/pin.ts.
        map.addSource(SELECTED_SOURCE_ID, { type: "geojson", data: NO_PIN });
        map.addImage(PIN_IMAGE_ID, trianglePin(), { pixelRatio: PIN_PIXEL_RATIO });

        setRegionsUrl(manifest.regionsUrl ?? null);
        setRegionsVersion(manifest.regionsVersion ?? 1);
        setCitiesBase(manifest.citiesBase ?? null);

        // Outlines under the stories, which are under the labels — order
        // asserted in layers.test.ts. Hit targets paint nothing and go
        // under everything.
        for (const layer of hitLayers()) map.addLayer(layer);
        for (const layer of boundaryLayers()) map.addLayer(layer);

        // Pins on top; headlines below the basemap's place labels, so a
        // country/state name always wins symbol collision against a
        // headline and stays clickable. See firstPlaceLabelLayerId and
        // docs/DESIGN.md#regions.
        const [countryPins, storyPins, headlines] = storyLayers();
        // Legs go UNDER the pins (a pointer shouldn't hide data); leaves
        // go OVER them (a leaf IS data and must win the click).
        const [spiderLegs, spiderLeaves] = spiderLayers();
        map.addLayer(spiderLegs);
        map.addLayer(countryPins);
        map.addLayer(storyPins);
        map.addLayer(spiderLeaves);
        // The five best stories, drawn again above every other disc — see
        // topPinLayer for why (circle-sort-key can't read feature state).
        map.addLayer(topPinLayer());
        // Above every disc, including the top-5 copy: nothing may be
        // drawn over the triangle marking what the reader picked.
        map.addLayer(selectedPinLayer());
        map.addLayer(headlines, firstPlaceLabelLayerId(map.getStyle().layers));

        /* ------------------------------------------------------------------ */
        /* The top-5-on-screen highlight                                       */
        /* ------------------------------------------------------------------ */

        // The keys currently carrying the flag. Held here since
        // removeFeatureState needs to know what to clear, and MapLibre
        // offers no way to enumerate the states it holds.
        let marked: string[] = [];

        // Those of `marked` actually flagged on the vector source — every
        // one a spider has NOT displaced. A displaced story is drawn
        // twice (covered at its anchor, again as a leaf); flagging the
        // covered copy would let its ring poke out from behind the pin on
        // top of it. Its highlight travels on the leaf instead, as a property.
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

        // Applies the top-5 flags computed on `idle` (see `refresh` below
        // for why idle, not moveend). sameKeys stops the resulting
        // repaint from looping back into another idle.
        const applyTop = () => {
          const visible = marked.filter((key) => !displaced.has(key));
          if (sameKeys(visible, flagged)) return;

          for (const key of flagged) if (!visible.includes(key)) setTop(key, false);
          for (const key of visible) setTop(key, true);
          flagged = visible;
          // A bubbled headline replaces the 11px label under the pin.
          // Keyed on the bubbles themselves, not `marked` — the two part
          // company once the ring re-ranks, and dismissBubbles emptying
          // this list is what gives the five their small labels back.
          map.setFilter(LABELS_LAYER_ID, bubbleLabelFilter(bubbles.map((bubble) => bubble.story.url)));
          // Filter and feature state are set together, always, so the
          // top-5 copy layer and an ordinary pin can never swap places.
          map.setFilter(TOP_LAYER_ID, topFilter(visible));
        };

        /* ------------------------------------------------------------------ */
        /* Spiderfy                                                            */
        /* ------------------------------------------------------------------ */

        // The stacks found at the last idle. Membership changes only when
        // rendered features change; positions change on every camera move
        // (a leaf is a pixel offset). Keeping the two apart lets the
        // expensive half run on idle and the cheap half run every frame.
        let stacks: Stack[] = [];

        // The records StoryBubbles is rendering, held here too since
        // applyTop reads them (on every idle, not a render) to decide
        // which small labels to suppress.
        let bubbles: TopStory[] = [];

        // Has the opening ranking been taken? Taken once; see `refresh`.
        let bubblesCaptured = false;

        // The opening ranking itself, held onto after `bubbles` is emptied
        // by dismissBubbles — this is what the "world" button restores.
        let capturedBubbles: TopStory[] = [];

        // Take the bubbles down permanently on the reader's first camera
        // move (movestart — drag, wheel, keyboard, or a search flyTo all
        // count). Armed only after the capture, so a startup camera
        // animation can't dismiss bubbles that were never drawn.
        const dismissBubbles = () => {
          if (!bubblesCaptured || !bubbles.length) return;
          bubbles = [];
          setTops(bubbles);
          // Directly, not through applyTop — its sameKeys guard would
          // skip this whenever the ranking hasn't changed, but the five
          // need their labels back on this move regardless.
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

        // On idle, not moveend: a move ends before the tiles it uncovered
        // have loaded, so ranking there would score the new viewport
        // against the old viewport's features and never correct itself.
        // idle is the first moment the query can answer truthfully.
        // sameKeys/sameStacks stop the resulting repaint from looping.
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
           * Taken once, at the first idle, over the default world view —
           * these are the top five in the world, not wherever the reader
           * is looking. dismissBubbles retires them on the first camera
           * move. Deduplicated by url, since renderWorldCopies and the
           * country floor can each draw a story more than once;
           * StoryBubbles normalises longitude to the nearest copy before
           * it projects, so which copy wins here doesn't matter.
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
              capturedBubbles = opening;
              bubblesCaptured = true;
              setTops(bubbles);
            }
          }

          // Stacks are read BEFORE the highlight is applied: which
          // stories a spider has displaced decides which of the five may
          // be flagged on the vector source at all.
          const found = map.getZoom() < SPIDERFY_ZOOM ? [] : stacksFrom(features);
          if (!sameStacks(found, stacks)) {
            stacks = found;
            displaced = displacedUrls(found);
          }

          applyTop();
          // Membership may be unchanged while the leaves' top-5 flags
          // (overlay data, not state) are not.
          drawSpider();
        };

        map.on("idle", refresh);
        // zoom, not move: a leaf is its anchor plus a pixel offset, and a
        // pan translates both together, so only a zoom needs a rebuild.
        map.on("zoom", drawSpider);

        // The "world" button: fly home and put the opening bubbles back.
        // dismissBubbles is off'd immediately so the flyTo's own movestart
        // doesn't dismiss the bubbles this is about to restore. Restoring
        // them waits for moveend rather than firing alongside flyTo: a
        // bubble is positioned by projecting its coordinate through the
        // CURRENT camera (StoryBubbles' pointFor), and setting it mid-flight
        // would project against wherever the animation happened to be,
        // often off-screen, which placeBubbles then drops. Once settled,
        // dismissBubbles goes back on so a move the reader makes afterward
        // still dismisses them once.
        const resetToHome = () => {
          map.off("movestart", dismissBubbles);
          setStory(null);
          clearRegion();
          map.once("moveend", () => {
            bubbles = capturedBubbles;
            setTops(bubbles);
            map.setFilter(
              LABELS_LAYER_ID,
              bubbleLabelFilter(bubbles.map((bubble) => bubble.story.url)),
            );
            map.on("movestart", dismissBubbles);
          });
          map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
        };
        resetHome.current = resetToHome;

        // One outline at a time, and none by default.
        const clearOutline = () => {
          for (const id of [COUNTRY_OUTLINE_ID, REGION_OUTLINE_ID]) {
            map.setFilter(id, MATCH_NOTHING);
          }
        };

        /**
         * The label gesture: a click that hit no pin may still have hit a
         * place label. The label gives the level; our own polygon hit-test
         * gives the id, for country and state — no name matching, ever
         * (see docs/DESIGN.md#the-label-based-gesture-and-no-name-matching-ever).
         * City and continent have no polygon to hit-test: a city resolves
         * by finding its country then snapping to the nearest record in
         * that country's shard (`lib/cities.ts`); a continent resolves
         * through the closed name table (`lib/continents.ts`). The camera
         * does not move — the panel surfaces the region's stories
         * directly, so a zoom here would be a move the reader didn't ask for.
         */
        const selectRegionAt = (event: MapMouseEvent) => {
          const label = firstLabel(map.queryRenderedFeatures(event.point));
          if (!label) return;

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
          const fallback: [number, number] = [event.lngLat.lng, event.lngLat.lat];

          if (label.level === "continent") {
            const id = continentIdFor(labelName(label.feature));
            if (!id) return;
            // No outline (~50 red country outlines would be a fill, not
            // a click-reveal) — just the triangle marking what was clicked.
            showPin(map, anchor ?? fallback);
            setSelection({ kind: "continent", id, name: labelName(label.feature) });
            return;
          }

          if (label.level === "city") {
            const iso = label.feature.properties?.iso_a2;
            let country = typeof iso === "string" ? fipsForIso(iso) : null;

            if (!country) {
              const countryHit = HIT_LAYER_FOR.country;
              if (countryHit && map.getLayer(countryHit)) {
                for (const point of points) {
                  const [polygon] = map.queryRenderedFeatures(point, { layers: [countryHit] });
                  const id = polygon?.properties?.id;
                  if (typeof id === "string" && id) {
                    country = id;
                    break;
                  }
                }
              }
            }

            // Natural Earth and the basemap disagree about what exists there
            // (a coastal or island label whose polygon test lands on water),
            // or `iso_a2` named a country the crosswalk does not carry. No
            // shard to fetch, so no click to answer.
            if (!country) return;

            showPin(map, anchor ?? fallback);
            setSelection({ kind: "city", country, name: labelName(label.feature), at: anchor ?? fallback });
            return;
          }

          const hitLayer = HIT_LAYER_FOR[label.level];
          if (!hitLayer || !map.getLayer(hitLayer)) return;

          for (const point of points) {
            const [polygon] = map.queryRenderedFeatures(point, { layers: [hitLayer] });
            const id = polygon?.properties?.id;
            if (typeof id !== "string" || !id) continue;

            const outlineLayer = OUTLINE_LAYER_FOR[label.level];
            if (outlineLayer) map.setFilter(outlineLayer, matchId(id));
            // On the label's own anchor where there is one, so the triangle
            // lands on the name the reader clicked rather than on the pixel
            // they happened to hit. A region has no orange circle of its own,
            // so here the triangle is the whole mark.
            showPin(map, anchor ?? fallback);
            setSelection({ kind: label.level, id, name: labelName(label.feature) });
            return;
          }

          // No polygon under the label: Natural Earth and the basemap
          // disagree about what exists there. Draw nothing rather than guess.
        };

        /**
         * One handler for the whole map, not one per layer — the
         * per-layer form would run twice on a click where the overlapping
         * stories/country-floor layers both match. Hit-testing once gives
         * a single deterministic answer in `CLICKABLE_LAYER_IDS` priority
         * order, and also gives the map a dismiss: clicking empty ocean
         * closes the panel and clears the outline.
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

          // A container story outlines its container in red; a PIN gets
          // none. Dead while containers are filtered off the map
          // (NOT_CONTAINER), but kept wired for when "somewhere in"
          // stories move into the region panel and need the same join.
          const outline = outlineFor(feature.properties);
          if (outline) {
            map.setFilter(outline.layerId, ["==", ["get", "id"], outline.id]);
          }

          // The triangle goes on the FEATURE's coordinate, not the click
          // point, so its tip meets the centre of the circle the reader
          // aimed at — on a spider leaf that's the displaced position,
          // which is correct: the tip must agree with what's on screen.
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
        // A manifest that won't load is the one failure where the map is
        // otherwise healthy (basemap, controls, no map error event), so
        // nothing else would ever say why the world is empty.
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
      // Both handlers close over a map that is about to be removed.
      redrawSpider.current = null;
      resetHome.current = null;
      map.remove();
      removeProtocol("pmtiles");
    };
  }, []);

  // `unavailable` is one state for two causes on purpose: no regionsUrl
  // and a failed index load are the same thing from the reader's side —
  // no list, working map.
  const panelStatus = !regionsUrl || indexFailed ? "unavailable" : index ? "ready" : "loading";

  /**
   * What `RegionPanel` gets, branched by `selection.kind`. Continent reads
   * the same index under its `CONT:XX` key, but a manifest older than
   * `regionsVersion: 2` never wrote one — without the version check,
   * `entryFor` resolving to an honestly-empty entry would read as "no
   * stories in Europe today" instead of "this run predates continents."
   * City has no `regionId`/outline; its heading is the MATCHED record's
   * name, never the clicked label's own text, since two cities can sit
   * inside each other's snap radius (`lib/cities.ts`) and showing one's
   * rows under the other's name would be a silent mislabel.
   */
  const cityRecord = cityRecordFor(selection, cityShard);
  const zoomBox = zoomTargetFor(selection);
  const onZoom = zoomBox ? zoomToRegion : null;

  const panel = !selection
    ? null
    : selection.kind === "city"
      ? {
          name: cityRecord?.name ?? selection.name,
          regionId: "",
          entry: cityRecord
            ? { stories: cityRecord.stories, total: cityRecord.total, sources: cityRecord.sources }
            : { stories: [], total: 0, sources: 0 },
          status: (!citiesBase || cityShardFailed
            ? "unavailable"
            : cityShard?.country === selection.country
              ? "ready"
              : "loading") as "loading" | "ready" | "unavailable",
          flagCode: selection.country,
          trail: [countryName(selection.country), cityRecord?.adm1Name ?? ""].filter(Boolean),
          onZoom,
        }
      : {
          name: selection.name,
          regionId: selection.id,
          entry: entryFor(index, selection.id),
          status: (selection.kind === "continent" && regionsVersion < 2
            ? "unavailable"
            : panelStatus) as "loading" | "ready" | "unavailable",
          flagCode: undefined,
          trail: undefined,
          onZoom,
        };

  return (
    <>
      <div ref={container} className="map" />

      <SearchBar onSelect={(place) => void selectPlace(place)} />

      {/*
        Bottom-right, left of MapLibre's own zoom control — see
        docs/DESIGN.md#regions for why the corner is otherwise free.
        Resets the camera to the opening view and brings the orange
        headline bubbles back.
      */}

      
      {/*
      <button
        type="button"
        className="reset-view-btn"
        style={worldBtnPos ?? undefined}
        onClick={() => resetHome.current?.()}
      >
        World
      </button>
      */}

      {/*
        The top five headlines, in bubbles pointing at their own pins.
        Outside the map container so MapLibre never sees the nodes — it
        owns its container's children.
      */}
      <StoryBubbles
        map={ready}
        stories={tops}
        selectedUrl={story?.url ?? null}
        onSelect={(selected, at) => selectStory(selected, at)}
      />

      {/*
        The story panel and region panel share one slot — a story click
        clears the region, so at most one is ever selected. Story renders
        first, making that guarantee visible here too.
      */}
      {story && <StoryPanel story={story} onClose={clearStory} />}

      {!story && panel && (
        <RegionPanel
          name={panel.name}
          regionId={panel.regionId}
          entry={panel.entry}
          status={panel.status}
          flagCode={panel.flagCode}
          trail={panel.trail}
          /* `null` hides the button — see `zoomTargetFor`. */
          onZoom={panel.onZoom}
          onClose={clearRegion}
        />
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
