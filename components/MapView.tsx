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
import { CLICKABLE_LAYER_IDS, SOURCE_ID, storyLayers } from "@/lib/layers";
import { loadManifest } from "@/lib/manifest";

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

        // Order matters and is asserted in layers.test.ts: country-top under
        // stories (they overlap), labels over both.
        for (const layer of storyLayers()) map.addLayer(layer);

        // §2.6 is link-out only: title, source, link. Never article text.
        for (const layer of CLICKABLE_LAYER_IDS) {
          map.on("click", layer, (event: MapLayerMouseEvent) => {
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

  return (
    <>
      <div ref={container} className="map" />
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
