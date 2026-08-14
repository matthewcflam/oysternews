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
 * **`minzoom` does NOT currently reach the archive**, so the budget above is
 * computed and discarded and the map is far denser than §9 allows. This is
 * known, measured, and not yet fixable — the documented remedy empties the map
 * instead. The long note on `featureOf` is the whole account; read it before
 * touching the directive.
 *
 * tippecanoe has no native Windows build (§6 decision 8), so on Windows this
 * shells into WSL. `scripts/build-tiles.sh` already solves that, including the
 * path translation, and is reused rather than reimplemented — its comment about
 * never routing a Windows path through `wslpath` cost twenty minutes to learn.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoryGroup } from "../lib/types.ts";

export const STORIES_LAYER = "stories";
export const COUNTRY_LAYER = "country-top";

/**
 * **A forward-slash literal, never `path.join`.** This is an argument to `bash`,
 * not a path for this process to open, and on Windows `path.join` returns
 * `scripts\run-tippecanoe.sh` — which bash reads as an escaped `r`, and reports
 * as `scriptsrun-tippecanoe.sh: No such file or directory`.
 *
 * The same family of bug as the `wslpath` note in `scripts/build-tiles.sh`, and
 * it hid for as long as it did because it is **Windows-only**: `path.join` gives
 * a forward slash on the Linux runner, so CI has always been fine and the dev
 * machine could not run the worker at all. Measured 2026-08-13, the first time
 * anyone ran `worker/run.ts` end to end on Windows.
 */
const SCRIPT = "scripts/run-tippecanoe.sh";

/**
 * A path as an argument to bash, not as a path for this process.
 *
 * Same hazard as `SCRIPT`, one level down: `path.join` builds these with
 * backslashes on Windows, and they cross the same argv boundary that ate the
 * script name. `run-tippecanoe.sh` does handle `C:\Users\x` — but only if the
 * backslashes survive the trip, and its own comment records the contract as
 * *"Node on Windows hands over C:/Users/x"*. This is that contract, made real
 * rather than assumed. A no-op on Linux, where there is nothing to replace.
 */
const posix = (value: string): string => value.replaceAll("\\", "/");

/**
 * §2.6 is link-out only: title, source, link. **Never article text.**
 *
 * That is a copyright constraint, and this function is where it is actually
 * enforced — a feature carries exactly these properties, so there is no path by
 * which body text could reach the browser even if something upstream started
 * carrying it. §7 critical gap 2 asks for a test that the popup contains title,
 * source and link and nothing else; this is the other half of it.
 *
 * ---------------------------------------------------------------------------
 * **The `tippecanoe` directive is in the WRONG PLACE ON PURPOSE. Read this
 * before you "fix" it.**
 *
 * It is inside `properties`, where tippecanoe does not look for it, so **every
 * per-feature `minzoom` from budget.ts is ignored and §2.4's density budget has
 * never run.** Measured 2026-08-14: world zoom serves ~1,714 pins on a phone
 * against §9's target of 30-60, and the country floor is starved to 1 feature.
 * That is a real, known, unfixed defect.
 *
 * **The documented fix was tried the same day and it emptied the map.** Moving
 * the object to the Feature level — a sibling of `geometry` and `properties`,
 * exactly as `man tippecanoe` specifies — published an archive containing
 * **exactly one feature per layer per tile at every zoom, everywhere**:
 *
 * ```
 *   London 8/127/85    before: stories=792     after: stories=1
 *   Delhi  10/731/427  before: stories=113     after: stories=1
 *   world  0/0/0       before: stories=3968    after: stories=1
 * ```
 *
 * Reproduced standalone on tippecanoe 2.49.0, away from this repo: 218
 * well-spread points in one layer, no other change.
 *
 * ```
 *   "tippecanoe": {"minzoom": 0}  at Feature level  ->    1 feature at z0
 *   "tippecanoe": {"minzoom": "0"} (string)         ->  218   (directive ignored)
 *   no directive at all                             ->  218
 * ```
 *
 * Not a flag interaction — it survives dropping `--drop-densest-as-needed`,
 * `-r1`, `-r0`, `-B0`, `-Bg`, and `--no-feature-limit --no-tile-size-limit`. It
 * contradicts the man page, which says a per-feature `minzoom` is *preserved*
 * down to that zoom "even if dot-dropping with `-r` would otherwise have dropped
 * it". **Cause not yet understood.**
 *
 * So the two known states are *too many pins* and *no pins*, and this file
 * currently ships the first, because a busy map beats an empty one. **Do not
 * move this line without republishing and decoding real tiles at real
 * coordinates** — every unit test and the tippecanoe exit code pass in both
 * states, and the browser is the only place either failure is visible.
 * ---------------------------------------------------------------------------
 */
function featureOf(group: StoryGroup): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [group.lon, group.lat] },
    // NOTE: the directive is back inside `properties` below, which tippecanoe
    // ignores. That is deliberate and it is not the end state. See the note
    // above `featureOf` before changing it — moving it here, which is what the
    // tippecanoe man page tells you to do, empties the map.
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
    // Progress only, not the summary. Tippecanoe's per-tile progress is a single
    // carriage-returned line tens of thousands of characters long, which in a CI
    // log (or a captured buffer) buries everything printed after it — including
    // the run summary and any stack trace. That has cost one unexplained failure
    // already.
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

/**
 * Run tippecanoe, natively where it exists and through WSL on Windows.
 *
 * The script is the single place that knows about the WSL path translation, so
 * CI (Linux, native tippecanoe) and this machine (Windows, WSL) take the same
 * code path here.
 */
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
