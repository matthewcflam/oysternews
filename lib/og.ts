/**
 * The browser's half of the panel thumbnail.
 *
 * Memoized per article url, and **the memo holds the promise, not the result** —
 * the same reason `loadRegionIndex` does. Clicking two stories quickly, or
 * clicking back to one already seen, must not open a second lookup for a page
 * that is already being read.
 *
 * `null` is a real, cached answer: an article with no `og:image` should be asked
 * about once per session, not once per click. A *rejected* lookup is different
 * and is evicted, so a network blip does not pin an empty header on a story for
 * the rest of the session.
 */

const cache = new Map<string, Promise<string | null>>();

/**
 * The article's preview image, or `null`.
 *
 * Never rejects. The panel has one fallback for every failure — the flat accent
 * header — so a caller has nothing to decide between "no image declared" and "the
 * lookup failed", and making it handle both would only produce two code paths
 * that render the same thing.
 */
export function loadOgImage(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return hit;

  const pending = fetch(`/api/og?url=${encodeURIComponent(url)}`)
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as { image?: unknown };
      return typeof body.image === "string" && body.image ? body.image : null;
    })
    .catch(() => {
      // Evict, so the next click retries rather than inheriting a blip.
      cache.delete(url);
      return null;
    });

  cache.set(url, pending);
  return pending;
}

/** Test seam, and the escape hatch if a run boundary ever needs the cache dropped. */
export function resetOgCache(): void {
  cache.clear();
}
