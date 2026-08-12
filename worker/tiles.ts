/**
 * Tile building. I/O — a tippecanoe subprocess (HANDOFF.md §3.3).
 *
 * §3.1 locks the flags: `-Z0 -z12 -r1 --drop-densest-as-needed`. **`-r1` is not
 * a typo and not a tuning knob** — it disables tippecanoe's own radial dropping,
 * because rank thinning is done by per-feature `minzoom` from worker/budget.ts.
 * Letting tippecanoe drop features too would silently discard the ones §2.5
 * chose to keep, using a rule that knows nothing about salience or tier-1.
 *
 * Two layers, one archive (§2.4):
 *
 *   stories       per-tile top-K, minzoom from the budget
 *   country-top   top 1 per country, minzoom 0, exempt from the budget
 *
 * tippecanoe reads a per-feature `tippecanoe` property object, which is how
 * `minzoom` gets from budget.ts into the archive.
 *
 * tippecanoe has no native Windows build (§6 decision 8), so on Windows this
 * shells into WSL. `scripts/build-tiles.sh` already solves that, including the
 * path translation, and is reused rather than reimplemented — its comment about
 * never routing a Windows path through `wslpath` cost twenty minutes to learn.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoryGroup } from "@/lib/types";

export const STORIES_LAYER = "stories";
export const COUNTRY_LAYER = "country-top";

/**
 * §2.6 is link-out only: title, source, link. **Never article text.**
 *
 * That is a copyright constraint, and this function is where it is actually
 * enforced — a feature carries exactly these properties, so there is no path by
 * which body text could reach the browser even if something upstream started
 * carrying it. §7 critical gap 2 asks for a test that the popup contains title,
 * source and link and nothing else; this is the other half of it.
 */
function featureOf(group: StoryGroup): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [group.lon, group.lat] },
    properties: {
      title: group.title,
      source: group.domain,
      url: group.url,
      place: group.placeName,
      kind: group.kind,
      region: group.regionId,
      country: group.countryCode,
      // Kept for the §2.3 freshness stamp and for debugging why a pin ranks
      // where it does. Numbers and dates, never prose.
      salience: Number(group.salience.toFixed(4)),
      domains: group.distinctDomains,
      tier1: group.tier1Fresh ? 1 : 0,
      date: group.newestArticle,
      tippecanoe: { minzoom: group.minzoom },
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

/**
 * Write both layers and run tippecanoe over them.
 *
 * `maxZoom` is tippecanoe's ceiling, NOT the budget's data cap. Features whose
 * minzoom sits above it are simply never rendered, which is how budget.ts's
 * overflow disappears from the map without being deleted from the pipeline.
 */
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
    "-Z0",
    "-z12",
    "-r1",
    "--drop-densest-as-needed",
    "-o",
    outputPath,
    "-L",
    `${STORIES_LAYER}:${storiesFile}`,
    "-L",
    `${COUNTRY_LAYER}:${countryFile}`,
  ]);

  return {
    archive: outputPath,
    storiesWritten: stories.length,
    countryTopWritten: countryTop.length,
  };
}

/**
 * Run tippecanoe, natively where it exists and through WSL on Windows.
 *
 * The script is the single place that knows about the WSL path translation, so
 * CI (Linux, native tippecanoe) and this machine (Windows, WSL) take the same
 * code path here.
 */
function runTippecanoe(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join("scripts", "run-tippecanoe.sh"), ...args], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tippecanoe exited ${code}`));
    });
  });
}
