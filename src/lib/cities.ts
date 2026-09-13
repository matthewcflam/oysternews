import type { CityRecord, CityShard } from "./types";

const pending = new Map<string, Promise<CityShard>>();

// A 404 is normal (the country has no shard). Only a 5xx or network failure clears the
// cache, so the next click retries.
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

export function resetCityShardCache(): void {
  pending.clear();
}

// Fixed, not zoom-scaled: the same click must give the same answer at every zoom.
export const CITY_SNAP_KM = 25;

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// renderWorldCopies can hand back longitudes outside [-180, 180].
function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function nearestCity(
  shard: CityShard,
  at: [number, number],
  maxKm = CITY_SNAP_KM
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
