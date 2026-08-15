"use client";

import { useEffect, useState } from "react";
import { freshnessLabel, isStale, loadManifest } from "@/lib/manifest";

/**
 * §2.3's freshness stamp, and §8's explicit notice past 2× cadence.
 *
 * **It no longer positions itself (2026-08-14).** It used to be absolutely
 * placed in the map's top-right corner, as the last survivor of the deleted
 * masthead. That corner now holds the brand block, and this is the second line
 * of it — so the component renders a plain paragraph and `BrandMark` decides
 * where the block goes. One element owning both its content and its corner is
 * what made the corner impossible to reuse.
 *
 * **Renders nothing until the effect runs**, on purpose. The label is a function
 * of `Date.now()`, so a server render and the hydration that follows it disagree
 * by exactly the network latency between them — the textbook hydration mismatch.
 * This app already carries one piece of extension-injected console noise; a real
 * mismatch underneath it would be invisible in the same log.
 *
 * The manifest fetch is shared with MapView through `loadManifest`'s memo, so
 * mounting this costs no extra request.
 */
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
      // Silent: MapView owns the visible error for an unreadable manifest, and
      // two notices for one failure is worse than one.
      .catch(() => {});

    // A tab left open should not keep claiming "updated 2 minutes ago" all
    // afternoon. The label is coarse, so re-reading the clock each minute is
    // enough to keep it honest.
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
