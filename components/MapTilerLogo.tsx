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
 * **It is a component because it is drawn twice.** One copy sits bottom-left of
 * the map; a second sits bottom-left inside the story panel, which is full-bleed
 * and covers exactly that corner when open. Two call sites rendering the same
 * requirement is the failure mode this file exists to prevent — the requirement
 * fails silently (the map keeps working, the mark is simply not on screen), so
 * there would be nothing to notice if one copy drifted from the other.
 */
export default function MapTilerLogo({ className }: { className?: string }) {
  if (basemap().provider !== "maptiler") return null;

  return (
    <a
      className={className ? `maptiler-logo ${className}` : "maptiler-logo"}
      href="https://www.maptiler.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" width={110} height={30} />
    </a>
  );
}
