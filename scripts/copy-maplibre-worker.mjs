// MapLibre 6 spawns its worker from a runtime URL no bundler resolves (a silent 404, no tiles).
// setWorkerUrl needs it as a static asset; both files share a directory for the relative import.
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
