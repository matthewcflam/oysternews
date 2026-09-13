"use client";

import { basemap } from "@/lib/basemap";

// MapTiler's Free plan requires the logo, not just the text credit, and MapLibre's
// AttributionControl renders text only. Show it only for the MapTiler provider.
export default function MapTilerLogo() {
  if (basemap().provider !== "maptiler") return null;

  return (
    <a
      className="maptiler-logo"
      href="https://www.maptiler.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      {/* biome-ignore lint/performance/noImgElement: remote logo, unknown host */}
      <img
        src="https://api.maptiler.com/resources/logo.svg"
        alt="MapTiler"
        width={110}
        height={30}
      />
    </a>
  );
}
