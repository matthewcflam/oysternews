import MapView from "@/components/MapView";

export default function Home() {
  return (
    <main>
      <MapView />
      <header className="masthead">
        <h1>Sonder</h1>
        {/*
          Honest about what this is: one 15-minute GDELT bundle baked into the
          archive at build time. The rolling 24-hour window and the freshness
          stamp are Phase 3/4 — until then the map does not move on its own, and
          saying so is cheaper than letting someone assume it is live.
        */}
        <p>Real stories, one 15-minute GDELT bundle. Frozen at build time.</p>
      </header>
    </main>
  );
}
