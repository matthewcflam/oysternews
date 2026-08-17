"use client";

import { basemap } from "@/lib/basemap";

/**
 * §2.6: "MapTiler attribution and logo stay visible."
 *
 * MapTiler's Free plan requires the LOGO, not just the text credit, and
 * MapLibre's `AttributionControl` only renders text — the MapTiler SDK is what
 * would normally add this. Rendered only for the MapTiler provider: showing
 * their mark over an OpenFreeMap basemap would credit the wrong source.
 *
 * **It used to be drawn twice**, and the second copy is what this file was for:
 * the panels were full-bleed columns covering the map's bottom-left corner, so
 * each carried its own copy in its footer, and two call sites rendering the same
 * requirement is a thing that drifts silently. Modes 2 and 3 made both panels
 * floating cards ending ~200px above that corner — measured, not assumed — so
 * there is one copy again and it is the map's own.
 *
 * It stays a component: the mark is a plan requirement rather than decoration,
 * and it is worth one file that says so. If a surface ever covers that corner
 * again, render this in it rather than moving the anchor.
 */
export default function MapTilerLogo() {
  if (basemap().provider !== "maptiler") return null;

  return (
    <a
      className="maptiler-logo"
      href="https://www.maptiler.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" width={110} height={30} />
    </a>
  );
}
