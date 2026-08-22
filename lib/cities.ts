/**
 * The browser's half of the city panel: fetching a country's published
 * shard, and finding the record nearest a clicked label. Fetched lazily
 * per country, on the first city label click in it — same reasoning as
 * `lib/regions.ts`'s region index. Purely geographic match: `city_label`
 * carries no stable id, so `nearestCity` is a haversine search capped at a
 * fixed radius, giving the same click the same answer at every zoom.
 */

import type { CityRecord, CityShard } from "./types";

const pending = new Map<string, Promise<CityShard>>();

// Fetch one country's shard, memoized per URL like loadRegionIndex. A 404
// is normal (a country with no clustered cities publishes no shard),
// resolving to an empty array read the same as no record in range. Only a
// 5xx/network failure clears the cache so the next click retries.
export function loadCityShard(base: string, fips: string): Promise<CityShard> {
  const url = `${base}${fips}.json`;
  const cached = pending.get(url);
  if (cached) return cached;

  const promise = fetch(url)
    .then(async (response) => {
      if (response.status === 404) return [] as CityShard;
      if (!response.ok) throw new Error(`city shard: HTTP ${response.status}`);
      return (await response.json()) as CityShard;
    })
    .catch((cause: unknown) => {
      pending.delete(url);
      throw cause;
    });

  pending.set(url, promise);
  return promise;
}

/** Test seam. */
export function resetCityShardCache(): void {
  pending.clear();
}

/** How far a label click may snap to a clustered city. Fixed, not zoom- or rank-scaled: the same click must answer the same way at every zoom. */
export const CITY_SNAP_KM = 25;

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance in kilometres.
 *
 * Longitude is not normalized here — `nearestCity` does that once, on the
 * query point, which is cheaper than normalizing every record on every call.
 */
function haversineKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitude into [-180, 180] — `renderWorldCopies` can hand a label anchor back at, e.g., 190 (`MapView.tsx`'s own note on the same hazard). */
function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The record nearest `at`, within `maxKm` — or `null` when nothing in the
 * shard is close enough, which is the honest empty state, not an error.
 */
export function nearestCity(
  shard: CityShard,
  at: [number, number],
  maxKm = CITY_SNAP_KM,
): CityRecord | null {
  const query: [number, number] = [normalizeLng(at[0]), at[1]];

  let best: CityRecord | null = null;
  let bestKm = Number.POSITIVE_INFINITY;

  for (const record of shard) {
    const km = haversineKm(query, [record.lon, record.lat]);
    if (km < bestKm) {
      bestKm = km;
      best = record;
    }
  }

  return best && bestKm <= maxKm ? best : null;
}
