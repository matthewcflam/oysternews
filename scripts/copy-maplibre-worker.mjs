/**
 * Copies MapLibre's worker entry (and the shared chunk it imports) into public/.
 *
 * MapLibre 6 spawns its worker from a Blob containing `import "<url>"`, where the
 * url is computed at runtime from `import.meta.url`. No bundler can resolve that
 * statically: Turbopack emits a worker URL that 404s silently — the map parses the
 * style, paints the background, and then never loads a source or requests a tile,
 * with no error event. `transpilePackages: ["maplibre-gl"]` turns the same problem
 * into a hard "Can't resolve <dynamic>" build error.
 *
 * The supported escape hatch is `setWorkerUrl()` (components/MapView.tsx), which
 * needs the worker served as a real static asset — hence this copy. The two files
 * must land in the same directory because the worker imports the shared chunk with
 * a relative specifier.
 *
 * Runs from `predev` and `prebuild`, so the copies track the installed version and
 * cannot go stale after an upgrade. public/maplibre-gl-*.mjs is gitignored.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FROM = join(ROOT, "node_modules", "maplibre-gl", "dist");
const TO = join(ROOT, "public");
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(TO, { recursive: true });
for (const file of FILES) {
  await copyFile(join(FROM, file), join(TO, file));
  console.log(`maplibre worker asset: public/${file}`);
}
