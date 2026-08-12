import FreshnessStamp from "@/components/FreshnessStamp";
import MapView from "@/components/MapView";

export default function Home() {
  return (
    <main>
      <MapView />
      <header className="masthead">
        <h1>Sonder</h1>
        {/*
          True as of Phase 3G: the archive is published by the worker every four
          hours over a rolling 24-hour window, and the browser follows whatever
          manifest.json currently points at. The stamp below says when — a claim
          of freshness with no timestamp is the kind a visitor cannot check.
        */}
        <p>Real stories from the last 24 hours, published every four hours.</p>
        <FreshnessStamp />
      </header>
    </main>
  );
}
