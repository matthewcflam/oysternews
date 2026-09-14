"use client";

import type { FeatureCollection } from "geojson";
import {
  addProtocol,
  type ErrorEvent,
  type GeoJSONSource,
  MapLibreMap,
  type MapMouseEvent,
  NavigationControl,
  removeProtocol,
  setWorkerUrl,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemap, WORLD_BOUNDS } from "@/lib/basemap";
import { CITY_SNAP_KM, loadCityShard, nearestCity } from "@/lib/cities";
import { CONTINENT_BBOX, continentIdFor } from "@/lib/continents";
import { countryName, fipsForIso } from "@/lib/flag";
import { firstLabel, labelAnchor, labelName } from "@/lib/labels";
import {
  BOUNDARIES_ARCHIVE,
  BOUNDARIES_SOURCE_ID,
  basemapLabelLayerIds,
  boundaryLayers,
  bubbleLabelFilter,
  CLICKABLE_LAYER_IDS,
  COUNTRY_LAYER_ID,
  COUNTRY_OUTLINE_ID,
  COUNTRY_SOURCE_LAYER,
  firstPlaceLabelLayerId,
  HIT_LAYER_FOR,
  hitLayers,
  LABELS_LAYER_ID,
  MATCH_NOTHING,
  matchId,
  OUTLINE_LAYER_FOR,
  outlineFor,
  PIN_IMAGE_ID,
  REGION_OUTLINE_ID,
  SELECTED_SOURCE_ID,
  SELECTED_STATE_KEY,
  SOURCE_ID,
  SPIDER_SOURCE_ID,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
  selectedPinLayer,
  spiderLayers,
  storyLayers,
  TOP_LAYER_ID,
  TOP_STATE_KEY,
  topFilter,
  topPinLayer,
} from "@/lib/layers";
import { loadManifest } from "@/lib/manifest";
import { PIN_PIXEL_RATIO, trianglePin } from "@/lib/pin";
import type { PlaceEntry } from "@/lib/place-search";
import {
  type BboxTable,
  bboxFor,
  FIT_PADDING,
  loadRegionBboxes,
  MAX_FIT_ZOOM,
} from "@/lib/region-bbox";
import { entryFor, loadRegionIndex } from "@/lib/regions";
import {
  displacedUrls,
  EMPTY_SPIDER,
  leafPositions,
  SPIDERFY_ZOOM,
  type Stack,
  sameStacks,
  spiderData,
  stacksFrom,
} from "@/lib/spiderfy";
import { type PanelStory, panelStory } from "@/lib/story";
import { sameKeys, topKeys } from "@/lib/top";
import type { CityShard, RegionIndex } from "@/lib/types";
import CornerPanel, { ICON_SIZE, type PanelPos } from "./CornerPanel";
import RegionPanel from "./RegionPanel";
import SearchBar from "./SearchBar";
import StoryBubbles, { type TopStory } from "./StoryBubbles";
import StoryPanel from "./StoryPanel";

// MapLibre 6 builds its worker from a runtime URL Turbopack can't resolve; without this the
// map silently never loads a tile. predev/prebuild copy the worker into public/.
const WORKER_URL = "/maplibre-gl-worker.mjs";

type Selection =
  | { kind: "country" | "state"; id: string; name: string }
  | { kind: "continent"; id: string; name: string }
  | { kind: "city"; country: string; name: string; at: [number, number] };

const NO_PIN: FeatureCollection = { type: "FeatureCollection", features: [] };

const keyOf = (bubble: TopStory) => bubble.story.url;

const CORNER_CTRL_GAP = 6;
// earth.png has a 7px transparent border (of 128), so the gap is measured from the ink.
const GLOBE_ICON_SIZE = 28;
const GLOBE_INK_INSET = (7 / 128) * GLOBE_ICON_SIZE;

const HEADLINES_STORAGE_KEY = "oyster.headlines";
const LABELS_STORAGE_KEY = "oyster.labels";

function cityRecordFor(
  selection: Selection | null,
  cityShard: { country: string; shard: CityShard } | null
) {
  if (!selection || selection.kind !== "city") return null;
  if (cityShard?.country !== selection.country) return null;
  return nearestCity(cityShard.shard, selection.at, CITY_SNAP_KM);
}

// A GeoJSON source, not a Marker: a DOM marker lags a frame and slides off its dot.
const showPin = (map: MapLibreMap | null, at: [number, number] | null) => {
  const source = map?.getSource<GeoJSONSource>(SELECTED_SOURCE_ID);
  if (!source) return;
  source.setData(
    at
      ? {
          type: "FeatureCollection",
          features: [
            { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} },
          ],
        }
      : NO_PIN
  );
};

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = basemap().provider;

  // Measured, not a fixed offset: attribution can wrap and push the zoom control up. Observe
  // the whole corner, since attribution moves the group without resizing it.
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [globePos, setGlobePos] = useState<{ right: number; bottom: number; width: number } | null>(
    null
  );

  useEffect(() => {
    if (!ready) return;
    const corner = ready.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
    const group = corner?.querySelector<HTMLElement>(".maplibregl-ctrl-group");
    if (!corner || !group) return;

    const measure = () => {
      const containerRect = ready.getContainer().getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      // Flush with the zoom-out button, reaching under the group; the half-gap on each side
      // of the tag's cell makes every gap between glyphs and edges equal.
      const buttonHeight = group.lastElementChild?.getBoundingClientRect().height ?? 29;
      setPanelPos({
        right: containerRect.right - groupRect.right,
        bottom: containerRect.bottom - groupRect.bottom,
        height: buttonHeight,
        paddingRight: groupRect.width + (buttonHeight - ICON_SIZE) / 2,
      });
      setGlobePos({
        right: containerRect.right - groupRect.right,
        bottom: containerRect.bottom - groupRect.top + CORNER_CTRL_GAP - GLOBE_INK_INSET,
        width: groupRect.width,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(corner);
    observer.observe(group);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ready]);

  const [story, setStory] = useState<PanelStory | null>(null);

  // Refs, not state: both readers are written from map code outside React's render order,
  // so state would paint the disc a render late.
  const selectedUrl = useRef<string | null>(null);
  const redrawSpider = useRef<(() => void) | null>(null);

  const resetHome = useRef<(() => void) | null>(null);

  const [tops, setTops] = useState<TopStory[]>([]);

  // Read in a mount effect, not the useState initializer: the server render never saw
  // storage, so hydration would mismatch.
  const [headlinesOn, setHeadlinesOn] = useState(true);
  const headlinesOnRef = useRef(true);
  const toggleHeadlines = useRef<((on: boolean) => void) | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HEADLINES_STORAGE_KEY);
      if (stored !== null) setHeadlinesOn(stored === "true");
    } catch {}
  }, []);

  useEffect(() => {
    headlinesOnRef.current = headlinesOn;
    toggleHeadlines.current?.(headlinesOn);
  }, [headlinesOn]);

  // Persist only here, never from the effect above, or the mount's default overwrites the
  // stored value.
  const setHeadlines = (on: boolean) => {
    setHeadlinesOn(on);
    try {
      window.localStorage.setItem(HEADLINES_STORAGE_KEY, String(on));
    } catch {}
  };

  const [labelsOn, setLabelsOn] = useState(true);
  const labelsOnRef = useRef(true);
  const toggleLabels = useRef<((on: boolean) => void) | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LABELS_STORAGE_KEY);
      if (stored !== null) setLabelsOn(stored === "true");
    } catch {}
  }, []);

  useEffect(() => {
    labelsOnRef.current = labelsOn;
    toggleLabels.current?.(labelsOn);
  }, [labelsOn]);

  const setLabels = (on: boolean) => {
    setLabelsOn(on);
    try {
      window.localStorage.setItem(LABELS_STORAGE_KEY, String(on));
    } catch {}
  };

  const [regionsUrl, setRegionsUrl] = useState<string | null>(null);
  const [regionsVersion, setRegionsVersion] = useState<number>(1);
  const [citiesBase, setCitiesBase] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [index, setIndex] = useState<RegionIndex | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);
  // Kept with its country so a shard still in flight for a new selection is never read as its answer.
  const [cityShard, setCityShard] = useState<{ country: string; shard: CityShard } | null>(null);
  const [cityShardFailed, setCityShardFailed] = useState(false);

  const [bboxes, setBboxes] = useState<BboxTable | null>(null);

  const markSelected = (url: string | null) => {
    const map = mapRef.current;
    const previous = selectedUrl.current;
    selectedUrl.current = url;
    if (!map) return;

    for (const sourceLayer of [STORIES_SOURCE_LAYER, COUNTRY_SOURCE_LAYER]) {
      if (previous) {
        map.removeFeatureState(
          { source: SOURCE_ID, sourceLayer, id: previous },
          SELECTED_STATE_KEY
        );
      }
      if (url) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer, id: url },
          { [SELECTED_STATE_KEY]: true }
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

  const BBOX_OVERRIDES: Record<string, [number, number, number, number]> = {
    FR: [-5.14, 41.33, 9.56, 51.1],
    US: [-137.0, 24.39, -66.93, 49.38],
    NO: [4.5, 57.9, 31.1, 71.2],
    NL: [3.3, 50.7, 7.2, 53.6],
    EC: [-100.0, -5.5, -70.0, 2.5],
  };

  const CITY_ZOOM_PAD = 0.12;

  const zoomTargetFor = (current: Selection | null): [number, number, number, number] | null => {
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

  const fitTo = (box: [number, number, number, number] | null) => {
    const map = mapRef.current;
    if (!map || !box || box.length < 4) return;

    const [minLng, minLat, maxLng, maxLat] = box;

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM }
    );
  };

  const zoomToRegion = () => fitTo(zoomTargetFor(selection));

  const clearStory = () => {
    setStory(null);
    clearRegion();
  };

  const selectStory = (selected: PanelStory, at: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;

    clearRegion();
    showPin(map, at);
    markSelected(selected.url);

    setStory(selected);
  };

  const selectPlace = async (place: PlaceEntry) => {
    const map = mapRef.current;
    if (!map) return;

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
            () => null
          );

    fitTo(box);

    if (place.kind === "country" || place.kind === "state") {
      const outlineLayer = OUTLINE_LAYER_FOR[place.kind];
      if (outlineLayer) map.setFilter(outlineLayer, matchId(place.id));
    }

    // No selection triangle: a search has no point, and a bbox centre can land in the sea
    // (Indonesia's in the Java Sea).
    setSelection({ kind: place.kind, id: place.id, name: place.name });
  };

  useEffect(() => {
    if (!selection || !regionsUrl || index) return;
    let cancelled = false;

    loadRegionIndex(regionsUrl)
      .then((loaded) => {
        if (!cancelled) setIndex(loaded);
      })
      .catch(() => {
        if (!cancelled) setIndexFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [selection, regionsUrl, index]);

  useEffect(() => {
    if (!selection || bboxes) return;
    let cancelled = false;

    loadRegionBboxes()
      .then((loaded) => {
        if (!cancelled) setBboxes(loaded);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selection, bboxes]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: clearStory/clearRegion are recreated each render; story/selection are what matter
  useEffect(() => {
    if (!story && !selection) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (story) clearStory();
      else clearRegion();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [story, selection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once map; captured callbacks only touch refs and state setters, and adding deps would rebuild the map
  useEffect(() => {
    if (!container.current) return;

    setWorkerUrl(WORKER_URL);

    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);

    const map = new MapLibreMap({
      container: container.current,
      style: basemap().styleUrl,
      bounds: WORLD_BOUNDS,
      fitBoundsOptions: { padding: FIT_PADDING },
      renderWorldCopies: true,
      // No rotation or pitch: with showCompass off there is no control to restore north-up.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: false },
    });

    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    setReady(map);

    // Dev-only test seam. Next inlines NODE_ENV, so this is stripped from production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __oysterMap?: unknown }).__oysterMap = map;
    }

    // Awaiting both promises is correct in either finish order.
    const loaded = new Promise<void>((resolve) => {
      map.on("load", () => resolve());
    });

    // Outside the manifest chain: basemap labels exist even when story data fails to load.
    // Region clicks hit-test these labels, so they stop working while labels are hidden.
    map.on("load", () => {
      const labelIds = basemapLabelLayerIds(map.getStyle().layers);
      toggleLabels.current = (on: boolean) => {
        for (const id of labelIds) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      };
      toggleLabels.current(labelsOnRef.current);
    });

    // The effect can unmount while these are in flight, and touching a removed map throws.
    let cancelled = false;

    Promise.all([loadManifest(), loaded])
      .then(([manifest]) => {
        if (cancelled) return;

        map.addSource(SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${manifest.url}`,
          // tippecanoe writes no feature ids: promote url on BOTH source layers or setFeatureState
          // and the top-5 highlight can't work.
          promoteId: {
            [STORIES_SOURCE_LAYER]: "url",
            [COUNTRY_SOURCE_LAYER]: "url",
          },
        });

        map.addSource(BOUNDARIES_SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${new URL(BOUNDARIES_ARCHIVE, window.location.href).href}`,
        });

        map.addSource(SPIDER_SOURCE_ID, { type: "geojson", data: EMPTY_SPIDER });

        map.addSource(SELECTED_SOURCE_ID, { type: "geojson", data: NO_PIN });
        map.addImage(PIN_IMAGE_ID, trianglePin(), { pixelRatio: PIN_PIXEL_RATIO });

        setRegionsUrl(manifest.regionsUrl ?? null);
        setRegionsVersion(manifest.regionsVersion ?? 1);
        setCitiesBase(manifest.citiesBase ?? null);

        for (const layer of hitLayers()) map.addLayer(layer);
        for (const layer of boundaryLayers()) map.addLayer(layer);

        const [countryPins, storyPins, headlines] = storyLayers();
        const [spiderLegs, spiderLeaves] = spiderLayers();
        map.addLayer(spiderLegs);
        map.addLayer(countryPins);
        map.addLayer(storyPins);
        map.addLayer(spiderLeaves);
        map.addLayer(topPinLayer());
        map.addLayer(selectedPinLayer());
        map.addLayer(headlines, firstPlaceLabelLayerId(map.getStyle().layers));

        // MapLibre can't enumerate the feature states it holds, so track what to clear.
        let marked: string[] = [];

        // Not flagged when a spider displaced them: the covered copy's ring would poke out from
        // behind the anchor. The leaf carries the flag instead.
        let flagged: string[] = [];
        let displaced = new Set<string>();

        const setTop = (key: string, top: boolean) => {
          // Both source layers, so the highlight survives the z4 handover without a repaint gap.
          for (const sourceLayer of [STORIES_SOURCE_LAYER, COUNTRY_SOURCE_LAYER]) {
            const feature = { source: SOURCE_ID, sourceLayer, id: key };
            if (top) map.setFeatureState(feature, { [TOP_STATE_KEY]: true });
            else map.removeFeatureState(feature, TOP_STATE_KEY);
          }
        };

        // sameKeys stops the resulting repaint from looping into another idle.
        const applyTop = () => {
          const visible = marked.filter((key) => !displaced.has(key));
          if (sameKeys(visible, flagged)) return;

          for (const key of flagged) if (!visible.includes(key)) setTop(key, false);
          for (const key of visible) setTop(key, true);
          flagged = visible;
          map.setFilter(
            LABELS_LAYER_ID,
            bubbleLabelFilter(bubbles.map((bubble) => bubble.story.url))
          );
          map.setFilter(TOP_LAYER_ID, topFilter(visible));
        };

        let stacks: Stack[] = [];

        let bubbles: TopStory[] = [];

        const dismissBubbles = () => {
          if (!bubbles.length) return;
          bubbles = [];
          setTops(bubbles);
          map.setFilter(LABELS_LAYER_ID, bubbleLabelFilter([]));
        };

        const showBubbles = (ranked: TopStory[]) => {
          if (!headlinesOnRef.current) return;
          if (sameKeys(ranked.map(keyOf), bubbles.map(keyOf))) return;
          bubbles = ranked;
          setTops(bubbles);
          map.setFilter(LABELS_LAYER_ID, bubbleLabelFilter(bubbles.map(keyOf)));
        };

        map.on("movestart", dismissBubbles);

        const drawSpider = () => {
          const source = map.getSource<GeoJSONSource>(SPIDER_SOURCE_ID);
          if (!source) return;
          const data =
            map.getZoom() < SPIDERFY_ZOOM || !stacks.length
              ? EMPTY_SPIDER
              : spiderData(stacks, map, marked, selectedUrl.current);
          source.setData(data);
        };

        redrawSpider.current = drawSpider;

        // On idle, not moveend: tiles a move uncovered haven't loaded yet, so ranking would score
        // the new viewport against the old viewport's features.
        const refresh = () => {
          const layers = [STORIES_LAYER_ID, COUNTRY_LAYER_ID].filter((id) => map.getLayer(id));
          if (!layers.length) return;
          // Pin layers only, never leaves: feeding the overlay back into its own input grows spiders on spiders.
          const features = map.queryRenderedFeatures({ layers });

          marked = topKeys(features);

          const found = map.getZoom() < SPIDERFY_ZOOM ? [] : stacksFrom(features);
          if (!sameStacks(found, stacks)) {
            stacks = found;
            displaced = displacedUrls(found);
          }

          // An idle that ranked nothing leaves the bubbles alone: this viewport's tiles haven't
          // loaded, and blanking would flicker the headlines.
          if (marked.length) {
            const bubbled = new Map<string, TopStory>();
            for (const feature of features) {
              if (feature.geometry.type !== "Point") continue;
              const selected = panelStory(feature.properties);
              if (!selected || bubbled.has(selected.url)) continue;
              bubbled.set(selected.url, {
                story: selected,
                lngLat: feature.geometry.coordinates as [number, number],
              });
            }

            const leaves = stacks.length ? leafPositions(stacks, map) : null;

            showBubbles(
              marked
                .map((key) => bubbled.get(key))
                .filter((bubble): bubble is TopStory => Boolean(bubble))
                .map((bubble) => {
                  const leaf = displaced.has(bubble.story.url)
                    ? leaves?.get(bubble.story.url)
                    : null;
                  return leaf ? { ...bubble, lngLat: leaf } : bubble;
                })
            );
          }

          applyTop();
          drawSpider();
        };

        map.on("idle", refresh);
        map.on("zoom", drawSpider);

        // On calls refresh() directly: the camera is stationary, so no idle would fire.
        toggleHeadlines.current = (on: boolean) => {
          if (on) refresh();
          else dismissBubbles();
        };

        const resetToHome = () => {
          setStory(null);
          clearRegion();
          const camera = map.cameraForBounds(WORLD_BOUNDS, { padding: FIT_PADDING });
          if (camera) map.flyTo(camera);
        };
        resetHome.current = resetToHome;

        const clearOutline = () => {
          for (const id of [COUNTRY_OUTLINE_ID, REGION_OUTLINE_ID]) {
            map.setFilter(id, MATCH_NOTHING);
          }
        };

        const selectRegionAt = (event: MapMouseEvent) => {
          const label = firstLabel(map.queryRenderedFeatures(event.point));
          if (!label) return;

          // The label's anchor, not the click point (a click can land outside the coastline). The click
          // point is the fallback when a world-copy label projects off-screen.
          const anchor = labelAnchor(label.feature);
          const points = anchor ? [map.project(anchor), event.point] : [event.point];
          const fallback: [number, number] = [event.lngLat.lng, event.lngLat.lat];

          if (label.level === "continent") {
            const id = continentIdFor(labelName(label.feature));
            if (!id) return;
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

            if (!country) return;

            showPin(map, anchor ?? fallback);
            setSelection({
              kind: "city",
              country,
              name: labelName(label.feature),
              at: anchor ?? fallback,
            });
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
            showPin(map, anchor ?? fallback);
            setSelection({ kind: label.level, id, name: labelName(label.feature) });
            return;
          }
        };

        // One handler for the whole map: per-layer handlers fire twice where layers overlap.
        map.on("click", (event: MapMouseEvent) => {
          const layers = CLICKABLE_LAYER_IDS.filter((id) => map.getLayer(id));
          const [feature] = map.queryRenderedFeatures(event.point, { layers });

          setStory(null);
          clearRegion();
          clearOutline();

          // A pin is hit-tested first and wins the tap over a label.
          if (!feature) {
            selectRegionAt(event);
            return;
          }

          const selected = panelStory(feature.properties);
          if (!selected) return;

          const outline = outlineFor(feature.properties);
          if (outline) {
            map.setFilter(outline.layerId, ["==", ["get", "id"], outline.id]);
          }

          // The feature's coordinate, not the click point, so the tip meets the circle on screen
          // (for a spider leaf, its displaced position).
          selectStory(
            selected,
            feature.geometry.type === "Point"
              ? (feature.geometry.coordinates as [number, number])
              : [event.lngLat.lng, event.lngLat.lat]
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
        // The one failure where the map is otherwise healthy, so nothing else would say why it's empty.
        setError(
          `Story data unavailable — could not read the manifest. (${
            cause instanceof Error ? cause.message : String(cause)
          })`
        );
      });

    map.on("error", (event: ErrorEvent) => {
      const message = event.error?.message ?? "unknown map error";
      if (/pmtiles|stories/i.test(message)) {
        setError(`Story tiles unavailable — the published archive did not load. (${message})`);
      }
    });

    return () => {
      cancelled = true;
      setReady(null);
      redrawSpider.current = null;
      resetHome.current = null;
      toggleHeadlines.current = null;
      toggleLabels.current = null;
      map.remove();
      removeProtocol("pmtiles");
    };
  }, []);

  const panelStatus = !regionsUrl || indexFailed ? "unavailable" : index ? "ready" : "loading";

  // Without the regionsVersion check, a pre-continent index reads as "no stories in Europe".
  // A city heads with the MATCHED record's name, never the clicked label's text.
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

      <CornerPanel
        position={panelPos}
        headlinesOn={headlinesOn}
        onHeadlinesChange={setHeadlines}
        labelsOn={labelsOn}
        onLabelsChange={setLabels}
      />

      <button
        type="button"
        className="globe-btn"
        style={globePos ?? undefined}
        onClick={() => resetHome.current?.()}
        title="Zoom to global view"
        aria-label="Zoom to global view"
      >
        <img src="/assets/earth.png" alt="" width={GLOBE_ICON_SIZE} height={GLOBE_ICON_SIZE} />
      </button>

      {/* Outside the map container: MapLibre owns its container's children. */}
      <StoryBubbles
        map={ready}
        stories={tops}
        selectedUrl={story?.url ?? null}
        onSelect={(selected, at) => selectStory(selected, at)}
      />

      {story && <StoryPanel story={story} onClose={clearStory} />}

      {!story && panel && (
        <RegionPanel
          name={panel.name}
          regionId={panel.regionId}
          entry={panel.entry}
          status={panel.status}
          flagCode={panel.flagCode}
          trail={panel.trail}
          onZoom={panel.onZoom}
          onClose={clearRegion}
        />
      )}
      {provider === "openfreemap" && (
        <div className="notice notice--info">
          Keyless basemap (OpenFreeMap escape hatch). Set <code>NEXT_PUBLIC_MAPTILER_KEY</code> for
          the MapTiler style.
        </div>
      )}
      {error && <div className="notice notice--error">{error}</div>}
    </>
  );
}
