/**
 * Tile building via a tippecanoe subprocess. Flags are locked: `-Z0 -z12 -r1
 * --drop-densest-as-needed` — `-r1` disables tippecanoe's own density
 * thinning, since worker/budget.ts's per-feature minzoom does that job
 * instead. Two layers: `stories` (per-tile top-K, minzoom from the budget)
 * and `country-top` (top 1/country, minzoom 0, exempt from the budget).
 * Requires tippecanoe >= 2.52.0 (see `featureOf` below and
 * docs/DESIGN.md#tiles-budget). tippecanoe has no native Windows build, so
 * on Windows this shells through `scripts/run-tippecanoe.sh` into WSL.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoryGroup } from "../lib/types.ts";

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

/**
 * Link-out only: title, source, link — never article text. This function is
 * where that's enforced; a feature carries exactly these properties, so no
 * body text can reach the browser.
 *
 * The `tippecanoe` object below MUST be a sibling of `geometry`/`properties`,
 * not nested inside `properties` — nesting it silently makes tippecanoe
 * ignore every minzoom budget.ts computes (world zoom served 1,714 pins
 * instead of 30-60 on the live archive). This placement in turn requires
 * tippecanoe >= 2.52.0, a hard floor enforced by scripts/run-tippecanoe.sh:
 * below it, an upstream bug (fixed in felt/tippecanoe bd48ba8, "Fix
 * accidental loss (at all zooms) of features with an explicit minzoom")
 * silently drops every feature that declares a minzoom down to one per
 * tile. Both failure modes are silent — exit 0, archive publishes, tests
 * pass — and only a decoded tile shows the difference. Verified by building
 * 2.49.0/2.52.0/2.79.0 and running the same 218 points through each:
 *
 * ```
 *                                   2.49.0      2.52.0    2.79.0
 *   no directive              z0 =     218         218       218
 *   minzoom 0 on every point  z0 =       1         218       218
 *   minzoom = i % 13          z0 =       1          17        17
 * ```
 *
 * Full post-mortem: docs/DESIGN.md#the-tippecanoe-2-49-0-post-mortem. Do not
 * change this without decoding real tiles at real coordinates.
 */
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
      // Thumbnail URL from GDELT's V2.1SHARINGIMAGE (not bytes — a link to
      // the publisher's own CDN, not reproduced content). See parse.ts.
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

// Write both layers and run tippecanoe over them. z12 is tippecanoe's render
// ceiling, not the budget's cap — features with minzoom above it are simply
// never rendered, which is how overflow disappears from the map without
// being deleted from the pipeline.
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

// Run tippecanoe, natively where it exists and through WSL on Windows —
// scripts/run-tippecanoe.sh is the single place that knows the WSL path
// translation, so CI and this machine take the same code path.
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
