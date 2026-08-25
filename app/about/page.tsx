import Link from "next/link";
import type { Metadata } from "next";

import { PUBLISHED_ACCURACY } from "@/lib/accuracy";

export const metadata: Metadata = {
  title: "About Oyster News",
  description:
    "Where the stories come from, how they are ranked, how each one is placed on the map, how accurate that placement was measured to be.",
};

export default function About() {
  return (
    <main className="about">
      <article>
        
        <h2>Credits</h2>
        <p>
          News data from the{" "}
          <a href="https://www.gdeltproject.org/" rel="noreferrer">
            GDELT Project
          </a>
          . Basemap tiles from{" "}
          <a href="https://www.maptiler.com/" rel="noreferrer">
            MapTiler
          </a>{" "}
          and{" "}
          <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">
            OpenStreetMap contributors
          </a>
          , rendered with{" "}
          <a href="https://maplibre.org/" rel="noreferrer">
            MapLibre GL JS
          </a>
          . Region boundaries from{" "}
          <a href="https://www.naturalearthdata.com/" rel="noreferrer">
            Natural Earth
          </a>
          .
        </p>

        <p className="about__back about__back--foot">
          <Link href="/">← Back to the map</Link>
        </p>
      </article>
    </main>
  );
}
