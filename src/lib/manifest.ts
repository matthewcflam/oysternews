import { ago } from "./age";
import { CDN_BASE } from "./cdn";
import type { Manifest } from "./types";

// Built from CDN_BASE, not NEXT_PUBLIC_*: those are inlined at build time, so a changed
// dashboard value does nothing until the next uncached build.
const MANIFEST_URL = process.env.NEXT_PUBLIC_MANIFEST_URL ?? `${CDN_BASE}/manifest.json`;

export const CADENCE_HOURS = 12;

let pending: Promise<Manifest> | null = null;

export function loadManifest(): Promise<Manifest> {
  pending ??= fetch(MANIFEST_URL, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`manifest: HTTP ${response.status}`);
    return (await response.json()) as Manifest;
  });
  return pending;
}

export function freshnessLabel(generatedAt: string, now: number): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return "Updated at an unknown time";

  return `Updated ${ago(at, now)}`;
}

// 2x cadence: one missed run is normal noise, two in a row means the worker is down.
export function isStale(generatedAt: string, now: number): boolean {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return true;
  return now - at > 2 * CADENCE_HOURS * 3600 * 1000;
}
