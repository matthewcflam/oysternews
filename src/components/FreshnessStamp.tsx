"use client";

import { useEffect, useState } from "react";
import { freshnessLabel, isStale, loadManifest } from "@/lib/manifest";

// Renders nothing until the effect runs: the label depends on Date.now(), so a server
// render would mismatch hydration.
export default function FreshnessStamp() {
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadManifest()
      .then((manifest) => {
        if (cancelled) return;
        setGeneratedAt(manifest.generatedAt);
        setNow(Date.now());
      })
      // Silent: MapView owns the visible error for an unreadable manifest.
      .catch(() => {});

    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (generatedAt === null || now === null) return null;

  const stale = isStale(generatedAt, now);

  return (
    <p className={stale ? "freshness freshness--stale" : "freshness"}>
      {freshnessLabel(generatedAt, now)}
      {stale && " — the worker has missed at least two runs."}
    </p>
  );
}
