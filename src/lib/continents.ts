export type ContinentId =
  | "CONT:AF"
  | "CONT:AN"
  | "CONT:AS"
  | "CONT:EU"
  | "CONT:NA"
  | "CONT:OC"
  | "CONT:SA";

const NAME_TO_ID: Record<string, ContinentId> = {
  africa: "CONT:AF",
  antarctica: "CONT:AN",
  asia: "CONT:AS",
  europe: "CONT:EU",
  "north america": "CONT:NA",
  "south america": "CONT:SA",
  oceania: "CONT:OC",
  australia: "CONT:OC",
};

export function continentIdFor(name: string | null | undefined): ContinentId | null {
  const key = (name ?? "").trim().toLowerCase();
  return NAME_TO_ID[key] ?? null;
}

// Not an invert of NAME_TO_ID: that map is many-to-one (oceania and australia).
export const CONTINENT_NAME: Record<ContinentId, string> = {
  "CONT:AF": "Africa",
  "CONT:AN": "Antarctica",
  "CONT:AS": "Asia",
  "CONT:EU": "Europe",
  "CONT:NA": "North America",
  "CONT:OC": "Oceania",
  "CONT:SA": "South America",
};

// Curated, not a union of member countries: Russia's box would stretch Europe to the Bering Strait.
export const CONTINENT_BBOX: Record<ContinentId, [number, number, number, number]> = {
  "CONT:AF": [-25.36, -46.97, 63.5, 37.5],
  "CONT:AN": [-180, -90, 180, -60],
  "CONT:AS": [26.0, -11.0, 191.0, 81.0],
  "CONT:EU": [-24.5, 34.5, 45.0, 71.5],
  "CONT:NA": [-168.0, 5.5, -52.0, 83.5],
  "CONT:OC": [110.0, -47.5, 210.5, 5.0],
  "CONT:SA": [-81.5, -56.0, -34.5, 12.5],
};
