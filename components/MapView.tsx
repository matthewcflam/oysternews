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
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemap } from "@/lib/basemap";

/**
 * Phase 2 skeleton (HANDOFF.md §5). One PMTiles archive of fake points over the
 * basemap, 2D Mercator, no globe. Grouping, containers, the top-K budget and the
 * country-floor layer are all Phase 3/4 — deliberately absent here.
 *
 * MapLibre 6 has no default export and aliases its Map class to avoid shadowing
 * the global `Map`, hence the named `MapLibreMap` import.
 */

const STORIES_ARCHIVE = "/stories.pmtiles";
const STORIES_SOURCE_LAYER = "stories";

/**
 * MapLibre 6 builds its worker from a Blob that does `import "<runtime url>"`,
 * which Turbopack cannot resolve. Left alone the worker silently 404s and the map
 * paints the basemap background but never loads a source or requests a tile — no
 * error event, no console warning. Pointing at the copy that `predev`/`prebuild`
 * place in public/ (scripts/copy-maplibre-worker.mjs) is the supported fix.
 */
const WORKER_URL = "/maplibre-gl-worker.mjs";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] as string,
  );

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = basemap().provider;

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
      center: [0, 20],
      zoom: 1.5,
      // §3.1: 2D Mercator, no globe projection.
      renderWorldCopies: true,
      attributionControl: { compact: false },
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const archiveUrl = new URL(STORIES_ARCHIVE, window.location.href).href;

      map.addSource("stories", {
        type: "vector",
        url: `pmtiles://${archiveUrl}`,
      });

      map.addLayer({
        id: "stories-pins",
        type: "circle",
        source: "stories",
        "source-layer": STORIES_SOURCE_LAYER,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 8, 7],
          "circle-color": "#e5484d",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      // §2.6 is link-out only: title, source, link. Never article text.
      map.on("click", "stories-pins", (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const { title, source, url } = feature.properties as Record<string, string>;
        new Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(event.lngLat)
          .setHTML(
            `<strong>${escapeHtml(title)}</strong><br>` +
              `<em>${escapeHtml(source)}</em><br>` +
              `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Read at source</a>`,
          )
          .addTo(map);
      });

      map.on("mouseenter", "stories-pins", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "stories-pins", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    // §7 critical gap 3: a missing or unreachable archive must say so rather than
    // render an empty region with no explanation.
    map.on("error", (event: ErrorEvent) => {
      const message = event.error?.message ?? "unknown map error";
      if (/pmtiles|stories/i.test(message)) {
        setError(`Story tiles unavailable — run \`npm run tiles:fake\`. (${message})`);
      }
    });

    return () => {
      map.remove();
      removeProtocol("pmtiles");
    };
  }, []);

  return (
    <>
      <div ref={container} className="map" />
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
