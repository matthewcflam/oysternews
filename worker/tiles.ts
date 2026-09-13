import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoryGroup } from "../src/lib/types.ts";

export const STORIES_LAYER = "stories";
export const COUNTRY_LAYER = "country-top";

// Forward slashes, never path.join: this is an argument to bash, and path.join's
// backslashes on Windows are read by bash as escapes.
const SCRIPT = "scripts/run-tippecanoe.sh";

// Same hazard as SCRIPT: backslashes don't survive the argv boundary into bash.
const posix = (value: string): string => value.replaceAll("\\", "/");

// The tippecanoe object must be a sibling of geometry/properties: nested, minzoom is
// silently ignored. Needs tippecanoe >= 2.52.0 (older versions drop such features).
function featureOf(group: StoryGroup): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [group.lon, group.lat] },
    // Must stay a number: {"minzoom": "0"} is silently discarded.
    tippecanoe: { minzoom: group.minzoom },
    properties: {
      title: group.title,
      source: group.domain,
      url: group.url,
      place: group.placeName,
      kind: group.kind,
      region: group.regionId,
      country: group.countryCode,
      image: group.image,
      salience: Number(group.salience.toFixed(4)),
      domains: group.distinctDomains,
      tier1: group.tier1Fresh ? 1 : 0,
      date: group.newestArticle,
    },
  };
}

export function toGeoJson(groups: StoryGroup[]): string {
  return `${JSON.stringify({
    type: "FeatureCollection",
    features: groups.map(featureOf),
  })}\n`;
}

export type TileBuild = {
  archive: string;
  storiesWritten: number;
  countryTopWritten: number;
};

export async function buildTiles(
  stories: StoryGroup[],
  countryTop: StoryGroup[],
  workDir: string,
  outputPath: string
): Promise<TileBuild> {
  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  const storiesFile = path.join(workDir, "stories.geojson");
  const countryFile = path.join(workDir, "country-top.geojson");
  await writeFile(storiesFile, toGeoJson(stories), "utf8");
  await writeFile(countryFile, toGeoJson(countryTop), "utf8");

  await runTippecanoe([
    "--force",
    "--name=sonder-stories",
    // -q: the per-tile progress line buries the run summary and stack trace in CI logs.
    "-q",
    "-Z0",
    "-z12",
    "-r1",
    "--drop-densest-as-needed",
    "-o",
    posix(outputPath),
    "-L",
    `${STORIES_LAYER}:${posix(storiesFile)}`,
    "-L",
    `${COUNTRY_LAYER}:${posix(countryFile)}`,
  ]);

  return {
    archive: outputPath,
    storiesWritten: stories.length,
    countryTopWritten: countryTop.length,
  };
}

function runTippecanoe(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [SCRIPT, ...args], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tippecanoe exited ${code}`));
    });
  });
}
