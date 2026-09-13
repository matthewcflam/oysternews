import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoryGroup } from "../src/lib/types.ts";

export const STORIES_LAYER = "stories";
export const COUNTRY_LAYER = "country-top";

// Forward-slash literal, never `path.join`: this is an argument to `bash`,
// not a path for this process, and `path.join` returns backslashes on
// Windows, which bash misreads as an escape (`scriptsrun-tippecanoe.sh: No
// such file or directory`).
const SCRIPT = "scripts/run-tippecanoe.sh";

// Same hazard as SCRIPT: path.join emits backslashes on Windows, which don't
// survive the argv boundary into bash. run-tippecanoe.sh expects forward
// slashes ("Node on Windows hands over C:/Users/x"); a no-op on Linux.
const posix = (value: string): string => value.replaceAll("\\", "/");

// tippecanoe object MUST sibling geometry/properties, not nested — nesting
// silently ignores minzoom. Requires tippecanoe >= 2.52.0 (earlier versions
// have a bug that drops features with minzoom). See docs/DESIGN.md#the-tippecanoe-2-49-0-post-mortem.
function featureOf(group: StoryGroup): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [group.lon, group.lat] },
    // Feature level, beside geometry/properties — see note above before
    // moving it. Must stay a number: {"minzoom": "0"} is silently discarded.
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
  outputPath: string,
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
    // -q suppresses tippecanoe's per-tile progress line, which is tens of
    // thousands of characters long and buries the run summary/stack trace
    // after it in any captured log.
    // biome-ignore lint/style/useConsistentArrayType: suppress per-tile progress spam in logs
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
