/**
 * The browser's entry point to the published data (HANDOFF.md §3.2).
 *
 * **Path A: the browser reads R2 directly, with no `/api/stories` in front.**
 * §3.2 sketched a Next route with `s-maxage=300`, and it was dropped on the
 * reasoning that the manifest IS the indirection the route would have provided —
 * the archive URL changes on every run and lives inside this file's response, so
 * the only fixed thing a client hardcodes is the manifest's own location. A route
 * would add a component that can fail independently of the thing it fronts,
 * against a codebase that has twice been broken by silent render failures (§11).
 * Adding it later is a one-constant change; nothing here forecloses it.
 *
 * Proxying the ARCHIVE through a route was rejected outright and should stay
 * rejected: PMTiles issues many small range requests, each of which would become
 * a Function invocation billed as Fast Data Transfer, which Vercel documents as
 * ~3× the cost of R2's egress-free Data Transfer the same bytes cost when served
 * direct.
 */

import { ago } from "./age";
import { CDN_BASE } from "./cdn";
import type { Manifest } from "./types";

/**
 * Public and non-secret — a public R2 bucket serves this to anyone with the
 * URL, which is the point. Built from `CDN_BASE` rather than read from
 * `NEXT_PUBLIC_*` deliberately: those are inlined at BUILD time, so a value
 * set in Vercel does nothing until the next uncached build (§11,
 * 2026-08-10). A constant in the repo cannot drift from the deploy that
 * way — `CDN_BASE` is the one shared between this file and the worker, so
 * the two halves cannot disagree. The env var still overrides, for pointing
 * a local dev server at a scratch store or an `r2.dev` probe.
 */
export const MANIFEST_URL = process.env.NEXT_PUBLIC_MANIFEST_URL ?? `${CDN_BASE}/manifest.json`;

/** §3.5. The freshness notice fires past 2× this, per §8. */
export const CADENCE_HOURS = 12;

let pending: Promise<Manifest> | null = null;

/**
 * Fetch the manifest once per page load, however many components ask for it.
 *
 * Memoized on the promise rather than the result so two components mounting in
 * the same tick share one request instead of racing two. The manifest carries
 * `max-age=60`, so a repeat visit is a browser cache hit anyway; this is about
 * not making the same request twice within a single render pass.
 */
export function loadManifest(): Promise<Manifest> {
  pending ??= fetch(MANIFEST_URL, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`manifest: HTTP ${response.status}`);
    return (await response.json()) as Manifest;
  });
  return pending;
}

/** Test seam, and the reset a hot reload wants. */
export function resetManifestCache(): void {
  pending = null;
}

/**
 * §2.3's relative freshness stamp.
 *
 * Deliberately coarse. The underlying data is a rolling 24-hour window assembled
 * twice a day, so minute-level precision would imply a currency the pipeline
 * does not have.
 *
 * **The ladder moved to `lib/age.ts` and is now shared with the story stamps**
 * (2026-08-14), which went relative in the same change. This keeps only what is
 * its own: the ISO parse, the "Updated " framing, and the unknown-time fallback —
 * a *missing* timestamp is a different statement from an old one, and `ago`
 * returns "" for it because a panel row with no date should render nothing.
 */
export function freshnessLabel(generatedAt: string, now: number): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return "Updated at an unknown time";

  return `Updated ${ago(at, now)}`;
}

/**
 * Whether to say so loudly. §8: "Data is stale — relative freshness stamp,
 * explicit notice past 2× cadence."
 *
 * 2× rather than 1× because a single missed run is normal operational noise —
 * GDELT skips slots, an Action queues late — while two consecutive misses means
 * the worker is not running, which is the failure the dead-man switch also
 * watches for. The two alarms are deliberately redundant: this one is the only
 * one a VISITOR can see.
 */
export function isStale(generatedAt: string, now: number): boolean {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return true;
  return now - at > 2 * CADENCE_HOURS * 3600 * 1000;
}
